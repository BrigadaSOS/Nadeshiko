import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { logger } from '~~/server/utils/logger';

/**
 * Definitions for one word, from Shirabe.
 *
 * The `wid` comes off a token: Shirabe parsed the corpus and stamped each word
 * with the id its own entry lives at, so there is no slug to reconstruct and no
 * homograph to guess at. A token with no `wid` has no entry, and the caller
 * should not reach this route at all.
 *
 * It is a server route and not a browser fetch because of the key. Shirabe
 * authenticates with a service key that is ours, not the visitor's, and a key
 * that reaches the browser is a key that has been given away. Same reasoning as
 * `nadeshikoApiKey` in server/utils/backendProxy.ts.
 */

const CACHE_SECONDS = 60 * 60 * 24;

// `locale` resolves the part-of-speech and misc labels into ONE language, and it
// is the only thing about this response that varies by reader: the definitions
// come back in every language the entry has and the caller picks. Clamped to
// what Shirabe ships a UI in, so an arbitrary query string cannot multiply the
// cached copies of a word that is the same for everyone.
const LABEL_LOCALES = new Set(['en', 'es']);

/**
 * Circuit breaker for the tailnet path.
 *
 * Falling back per request is correct but not enough on its own: if the tailnet
 * is down for a while, EVERY uncached lookup pays the direct path's timeout
 * before starting the request that actually works, and the feature this is meant
 * to speed up gets slower than it was before the shortcut existed.
 *
 * So a failure parks the direct path for a cooldown and traffic goes straight to
 * the public host. The cooldown doubles with each consecutive failure, up to a
 * ceiling, so an outage costs one slow request every few minutes rather than one
 * per lookup.
 *
 * State is per server process and deliberately in memory: it is a latency hint,
 * not a correctness one. A restart re-probing the fast path costs one timeout.
 */
const BREAKER_BASE_MS = 30_000;
const BREAKER_MAX_MS = 5 * 60_000;

const breaker = { openUntil: 0, consecutiveFailures: 0 };

/** Open, so the direct path is skipped and the public host answers. */
function directIsParked(now: number): boolean {
  return now < breaker.openUntil;
}

function recordDirectFailure(now: number): number {
  breaker.consecutiveFailures += 1;
  const cooldown = Math.min(BREAKER_MAX_MS, BREAKER_BASE_MS * 2 ** (breaker.consecutiveFailures - 1));
  breaker.openUntil = now + cooldown;
  return cooldown;
}

function recordDirectSuccess(): void {
  // Closed again. Reset the backoff rather than decaying it, so one recovered
  // request restores the fast path at full speed instead of leaving the next
  // failure escalating from wherever the last outage stopped.
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

export default defineEventHandler(async (event) => {
  const wid = getRouterParam(event, 'wid');
  if (!wid) throw createError({ statusCode: 400, statusMessage: 'wid is required' });

  const requested = String(getQuery(event).locale ?? '');
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  const config = useRuntimeConfig();
  const base = String(config.shirabeApiBase || 'https://shirabe.org').replace(/\/$/, '');
  const apiKey = String(config.shirabeApiKey || '').trim();
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: 'Shirabe lookups are not configured' });

  // Shirabe sits on another Hetzner box in the same city, and the public name
  // resolves to Cloudflare -- so left alone this call goes Helsinki → Cloudflare
  // → Helsinki for ~175ms, against ~33ms of actual work. `shirabeApiDirect` is
  // the tailnet address, which is a direct WireGuard hop.
  //
  // The public URL stays as a fallback rather than being replaced, because this
  // is on the reader's path: the tailnet is one more thing that can be down, and
  // a word popup that fails is worse than a slow one. A tailnet problem should
  // cost latency, not the feature.
  const direct = String(config.shirabeApiDirect || '')
    .trim()
    .replace(/\/$/, '');
  const path = `/v1/words/${encodeURIComponent(wid)}`;

  // Note for anyone tempted to send `Host: shirabe.org` on the direct call so
  // Rails' host authorization accepts it: it does not work. Node's fetch treats
  // Host as a forbidden header and drops it silently, so the request still
  // arrives claiming the bare IP and still 403s. Shirabe lists the tailnet
  // address in APP_HOSTS instead -- the fix belongs on the side that decides
  // which hosts are legitimate.
  const call = (origin: string, timeout: number): Promise<unknown> =>
    $fetch(`${origin}${path}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      // Examples are off for now (owner, 2026-08-06). Asking for them is what
      // makes them exist: `include=examples` is opt-in, it costs 2 to 3x the
      // latency on a common word, and with it absent `cardExamples` finds
      // nothing and the block does not render. Put 'examples' back to restore.
      query: { locale },
      timeout,
    });

  try {
    let word: unknown;

    const now = Date.now();

    if (direct && !directIsParked(now)) {
      try {
        // Short timeout: the direct path answers in tens of milliseconds, so
        // anything approaching a second means it is not working, and the reader
        // should not wait out the full budget before the fallback even starts.
        word = await call(direct, 1500);
        recordDirectSuccess();
      } catch (directError: unknown) {
        // A 404 is Shirabe answering about the WORD -- the path is healthy and
        // the public host would say the same thing a round trip later, so
        // rethrow it and leave the breaker closed.
        //
        // Only 404. Every other status is about this path rather than the word:
        // a 403 is Shirabe rejecting the Host header, a 401 a key it will not
        // take. Treating those as authoritative is what turned a misconfigured
        // shortcut into 502s for readers when the public host would have
        // answered perfectly well -- the fallback has to cover a direct path
        // that is reachable but wrong, not just one that is down.
        const directStatus = (directError as { response?: { status?: number } })?.response?.status;
        if (directStatus === 404) throw directError;

        const cooldown = recordDirectFailure(now);
        logger.warn(
          { err: directError, wid, cooldownMs: cooldown, failures: breaker.consecutiveFailures },
          'Shirabe direct lookup failed, parking the tailnet path and using the public host',
        );
        word = await call(base, 5000);
      }
    } else {
      // Either no direct path configured, or the breaker is open and this
      // request skips the timeout entirely. Once the cooldown lapses the next
      // request probes the direct path again -- that attempt IS the half-open
      // probe, so no separate health check is needed.
      word = await call(base, 5000);
    }

    // A dictionary entry is the same for everyone and changes when a dictionary
    // is reimported, so it caches hard. This is also what keeps a page of
    // twenty segments from spending twenty round trips on the same word.
    setResponseHeader(event, 'cache-control', `public, max-age=${CACHE_SECONDS}`);
    return word;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;

    // 404 is an ordinary answer here: a word can be parsed out of a subtitle and
    // still have no entry (a name, a coinage, a typo the corpus preserved). Say
    // so plainly rather than as a failure, so the popup shows the word unlinked.
    if (status === 404) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

    logger.warn({ wid, status, err: error }, 'Shirabe word lookup failed');
    throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
  }
});
