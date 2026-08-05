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

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

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

      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseRetryAfter(retryAfter)
        : backoffDelay(attempt, initialDelayMs, maxDelayMs);

      await sleep(waitMs);
      attempt++;
    }
  };
}
