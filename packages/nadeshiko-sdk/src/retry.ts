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

export function withRetry(
  fetchImpl: FetchLike = globalThis.fetch,
  options: RetryOptions = {},
): FetchLike {
  const { maxRetries = 2, initialDelayMs = 500, maxDelayMs = 30_000, timeout } = options;

  return async function retryingFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let attempt = 0;

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
        response = await fetchImpl(input, fetchInit);
      } catch (networkError) {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (attempt >= maxRetries) throw networkError;
        await sleep(backoffDelay(attempt, initialDelayMs, maxDelayMs));
        attempt++;
        continue;
      }

      if (timeoutId !== undefined) clearTimeout(timeoutId);

      if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) {
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
