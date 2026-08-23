import type { H3Event } from 'h3';
import { logger } from '~~/server/utils/logger';

/**
 * slug -> media publicId, for the `/media/<slug>` pages.
 *
 * The backend addresses media by `publicId` everywhere -- `GET /v1/media/{id}`
 * validates the path against `^[A-Za-z0-9_-]{12}$`, so a slug cannot be handed to
 * it -- and there is no slug filter on the list endpoint yet. Resolving a slug
 * therefore means knowing the whole catalogue, which is cheap enough to be worth
 * doing here rather than blocking the URL change on an API round trip: the
 * catalogue is 317 titles, or eight paginated calls, and it changes only when a
 * title is imported.
 *
 * ONE index serves every slug, which is the reason this is a module-level cache
 * and not `swr` on the route. A cached response per slug would mean eight
 * backend calls for each distinct slug a crawler asks for -- ~2.5k calls to warm
 * 317 pages -- because every miss would rebuild the same catalogue from scratch.
 *
 * When the SDK can be regenerated (it is currently pinned to a spec older than
 * the backend's in-flight one), the right shape is a `?slug=` filter on
 * `GET /v1/media` and this file becomes a two-line SDK call. The route contract
 * below does not change when that happens.
 */

interface MediaSlugIndex {
  bySlug: Map<string, string>;
  builtAt: number;
}

/** How long a built index is served without re-asking the backend. */
const TTL_MS = 60 * 60 * 1000;

/**
 * The floor between two rebuilds triggered by a MISS rather than by age.
 *
 * A miss is how a title imported ten minutes ago gets picked up before the hour
 * is out, so misses have to be able to refresh the index. It is also what a bot
 * walking `/media/<random>` produces, thousands of times, and each of those would
 * otherwise cost a full catalogue scan. A minute makes a real new title appear
 * almost immediately while capping the damage from a probe at one rebuild per
 * minute.
 */
const MISS_REBUILD_COOLDOWN_MS = 60 * 1000;

/**
 * The floor between two rebuilds triggered by AGE rather than by a miss.
 *
 * `inflight` collapses rebuilds that overlap, but not ones that follow each
 * other. A rebuild that fails leaves `cached` exactly as expired as it was, so
 * the next request starts another -- one full seven-call catalogue scan per
 * request, aimed at a backend that has just demonstrated it cannot answer.
 * Blocking made that self-limiting (the caller wore the latency); serving stale
 * removes the brake, so this replaces it.
 *
 * A minute, matching `MISS_REBUILD_COOLDOWN_MS`, and it costs the healthy case
 * nothing: a rebuild that succeeds moves `builtAt`, and nothing is stale again
 * for an hour.
 */
const AGE_REBUILD_COOLDOWN_MS = 60 * 1000;

let cached: MediaSlugIndex | null = null;
let lastMissRebuildAt = 0;
let lastAgeRebuildAt = 0;

/**
 * The in-flight build, so simultaneous first requests collapse into one scan
 * instead of each starting their own -- the same shape `segmentCache` uses for
 * the sentence permalink, and for the same reason.
 */
let inflight: Promise<MediaSlugIndex> | null = null;

async function buildIndex(event?: H3Event): Promise<MediaSlugIndex> {
  const sdk = useServerSdk(event);
  const bySlug = new Map<string, string>();

  for await (const media of sdk.listMedia.paginate({ take: 40 })) {
    if (media.slug) bySlug.set(media.slug, media.publicId);
  }

  return { bySlug, builtAt: Date.now() };
}

function refresh(event?: H3Event): Promise<MediaSlugIndex> {
  inflight ??= buildIndex(event)
    .then((index) => {
      cached = index;
      return index;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * Start a rebuild that nobody is waiting for.
 *
 * The `catch` is not politeness: an unhandled rejection in Nitro takes the
 * worker down, and this is the one call site where the promise is deliberately
 * dropped. A failed background rebuild is also not an error for the caller --
 * `cached` is left exactly as it was, so the next request is served the same
 * stale-but-correct index and tries again. It is logged because the alternative
 * is an index that quietly stops refreshing: nothing else here would ever
 * surface a backend that has been refusing `GET /v1/media` for an hour.
 *
 * The event rides along only for `trafficHeaders`, so a rebuild is attributed to
 * whichever request happened to notice the index had aged out. That is a wobble
 * in one attribution label, not a correctness problem, and it is the same event
 * the blocking rebuild used.
 */
function refreshInBackground(event?: H3Event): void {
  const now = Date.now();
  if (now - lastAgeRebuildAt < AGE_REBUILD_COOLDOWN_MS) return;
  lastAgeRebuildAt = now;

  void refresh(event).catch((error: unknown) => {
    logger.warn({ err: error }, 'Background media slug index rebuild failed; serving the previous index');
  });
}

/**
 * The publicId for a slug, or `null` when no title owns it.
 *
 * STALE BEATS BLOCKING, and the numbers are why. A rebuild is 7 sequential
 * `GET /v1/media` pages at ~105.7ms each -- ~740ms, measured in production on
 * 2026-08-23 -- and expiry used to hold the render for all of it. That landed on
 * ~5% of media renders, which is what puts `/:locale/media/:id` at 804ms p95
 * while the backend serving it sits at 45ms.
 *
 * Nothing is risked by serving the expired copy for the few hundred milliseconds
 * the rebuild takes. The TTL is an hour, so the index was already allowed to be
 * an hour out of date; a reader arriving one second after it expires gets an
 * answer that was acceptable one second earlier. And the index only ever gains
 * entries in practice -- a title's slug is fixed once imported -- so what a stale
 * copy can be wrong about is a title too NEW to be in it, which is the miss path
 * below, not this one.
 *
 * A miss against a fresh index is retried once against a rebuilt one, so a title
 * imported since the last build resolves rather than 404ing until the TTL
 * expires -- the sitemap lists a new title as soon as it exists, and a crawler
 * following that link must not be told the page is missing. That path still
 * blocks, and has to: there is no stale answer to hand back, only `null`.
 */
export async function resolveMediaSlug(slug: string, event?: H3Event): Promise<string | null> {
  const now = Date.now();
  const index = cached;

  // A genuinely cold process -- first request after a deploy or a restart. No
  // previous answer exists, so this one waits.
  if (!index) {
    const built = await refresh(event);
    // Deliberately not falling through to the miss path: this index was built
    // milliseconds ago, so a second scan could not name a title the first one
    // missed, and it would double the cost of the one request that already paid
    // full price.
    return built.bySlug.get(slug) ?? null;
  }

  if (now - index.builtAt >= TTL_MS) refreshInBackground(event);

  const hit = index.bySlug.get(slug);
  if (hit) return hit;

  if (now - lastMissRebuildAt < MISS_REBUILD_COOLDOWN_MS) return null;
  lastMissRebuildAt = now;

  // Joins the background rebuild above when one has just started -- `refresh`
  // hands back the in-flight promise rather than starting a second scan.
  const rebuilt = await refresh(event);
  return rebuilt.bySlug.get(slug) ?? null;
}

/** Test seam: drops the cache so a case can build its own. */
export function resetMediaSlugIndex(): void {
  cached = null;
  inflight = null;
  lastMissRebuildAt = 0;
  lastAgeRebuildAt = 0;
}
