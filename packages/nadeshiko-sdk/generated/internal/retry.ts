export interface RetryOptions {
  /** Number of retry attempts after the initial request. Default: 2 */
  maxRetries?: number;
  /** Initial delay in ms before first retry. Doubles with each attempt. Default: 500 */
  initialDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30_000 */
  maxDelayMs?: number;
  /**
   * Request timeout in ms. Each attempt gets its own timeout.
   * Default: none (no timeout).
   */
  timeout?: number;
  /**
   * Explicitly opt a non-idempotent request into retries. The callback is only
   * consulted for methods other than GET, HEAD, OPTIONS, PUT, and DELETE.
   * Use this for read-only POST endpoints such as search, never for creates.
   */
  retryUnsafeRequest?: (request: RetryRequest) => boolean;
}

export interface RetryRequest {
  method: string;
  url: string;
}

/**
 * Statuses worth trying again. Every one of these means "this attempt failed,
 * the next might not".
 *
 * 429 is deliberately NOT here, and it used to be. A rate limit is not a
 * transient failure, it is the server saying stop: retrying it is the one
 * response guaranteed to make the condition worse. That is not theoretical.
 * On 2026-08-09 an SSR path lost its rate-limit exemption, and because a 429
 * was retried twice, each render turned into three requests against a bucket
 * that was already full -- roughly two thousand visitor requests became 31,422
 * internal ones, and the site went down. The limiter worked; the client's
 * reaction to it is what collapsed.
 *
 * Callers get the 429 response back and can decide. A caller that wants to wait
 * has `Retry-After` on the response and knows its own context -- whether it is
 * a background job that can sleep, or a server-side render holding a worker.
 * This layer does not know that and so must not choose for them.
 */
const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

function parseRetryAfter(value: string): number {
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());
  return 1000;
}

function backoffDelay(attempt: number, initial: number, max: number): number {
  const jitter = Math.random() * 100;
  return Math.min(initial * 2 ** attempt + jitter, max);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * The input to hand a single attempt.
 *
 * A `Request` carries its body as a stream, and `fetch` consumes that stream.
 * Handing the SAME `Request` to a second attempt therefore cannot work: the
 * body is already gone, and the engine says so rather than sending an empty
 * one --
 *
 *     Chrome:  Failed to execute 'fetch' on 'Window': Cannot construct a
 *              Request with a Request object that has already been used.
 *     Firefox: Window.fetch: Body has already been consumed.
 *
 * Those two strings are one bug wearing two coats, and both reached readers:
 * ~70 reports from 16 people in the week to 2026-08-26, filed under three
 * separate fingerprints because error tracking groups on the message. They
 * cluster wherever the backend was returning a retryable status, which is
 * exactly when this path runs.
 *
 * So every attempt gets its own clone and the caller's `Request` is never the
 * one that goes on the wire -- cloning a stream you have not read is always
 * allowed, cloning one you have is not, so the original must stay untouched.
 * A URL or string input has no body to lose and is passed straight through.
 *
 * `Request` is absent in some runtimes this SDK is imported into, hence the
 * `typeof` guard rather than a bare `instanceof`.
 */
function attemptInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof Request !== 'undefined' && input instanceof Request) return input.clone();
  return input;
}

function retryRequest(input: RequestInfo | URL, init?: RequestInit): RetryRequest {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    // Fetch permits `init.method` to override the Request's own method.
    return { method: (init?.method ?? input.method).toUpperCase(), url: input.url };
  }
  return { method: (init?.method ?? 'GET').toUpperCase(), url: String(input) };
}

export function withRetry(
  fetchImpl: FetchLike = globalThis.fetch,
  options: RetryOptions = {},
): FetchLike {
  const { maxRetries = 2, initialDelayMs = 500, maxDelayMs = 30_000, timeout, retryUnsafeRequest } = options;

  return async function retryingFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let attempt = 0;
    const request = retryRequest(input, init);
    // Retrying after a network failure is not safe for a POST merely because
    // no response arrived: the server may have committed before the socket
    // dropped. Only known read-only POST operations opt in.
    const retryable = IDEMPOTENT_METHODS.has(request.method) || retryUnsafeRequest?.(request) === true;

    while (true) {
      // Set up per-attempt timeout if configured and caller didn't provide a signal
      let fetchInit = init;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (timeout !== undefined && !init?.signal) {
        const controller = new AbortController();
        timeoutId = setTimeout(
          () => controller.abort(new Error(`Request timed out after ${timeout}ms`)),
          timeout,
        );
        fetchInit = { ...init, signal: controller.signal };
      }

      let response: Response;
      try {
        response = await fetchImpl(attemptInput(input), fetchInit);
      } catch (networkError) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (!retryable || attempt >= maxRetries) throw networkError;
        await sleep(backoffDelay(attempt, initialDelayMs, maxDelayMs));
        attempt++;
        continue;
      }

      if (timeoutId !== undefined) clearTimeout(timeoutId);

      if (!retryable || !RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) {
        return response;
      }

      // `Retry-After` is clamped to the caller's own ceiling. It is a value the
      // server chooses, and an unclamped one lets the server park this client
      // for as long as it likes -- our own backend sends the whole remaining
      // window, up to 60s, which is how a single throttled call could hold a
      // server-side render hostage for a minute. `maxDelayMs` is the caller
      // saying how long they are willing to wait; a header does not outrank it.
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter
        ? Math.min(parseRetryAfter(retryAfter), maxDelayMs)
        : backoffDelay(attempt, initialDelayMs, maxDelayMs);

      await sleep(waitMs);
      attempt++;
    }
  };
}
