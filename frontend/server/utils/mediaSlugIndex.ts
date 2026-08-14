import type { H3Event } from 'h3';

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

let cached: MediaSlugIndex | null = null;
let lastMissRebuildAt = 0;

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
 * The publicId for a slug, or `null` when no title owns it.
 *
 * A miss against a fresh index is retried once against a rebuilt one, so a title
 * imported since the last build resolves rather than 404ing until the TTL
 * expires -- the sitemap lists a new title as soon as it exists, and a crawler
 * following that link must not be told the page is missing.
 */
export async function resolveMediaSlug(slug: string, event?: H3Event): Promise<string | null> {
  const now = Date.now();
  const index = cached && now - cached.builtAt < TTL_MS ? cached : await refresh(event);

  const hit = index.bySlug.get(slug);
  if (hit) return hit;

  if (now - lastMissRebuildAt < MISS_REBUILD_COOLDOWN_MS) return null;
  lastMissRebuildAt = now;

  const rebuilt = await refresh(event);
  return rebuilt.bySlug.get(slug) ?? null;
}

/** Test seam: drops the cache so a case can build its own. */
export function resetMediaSlugIndex(): void {
  cached = null;
  inflight = null;
  lastMissRebuildAt = 0;
}
