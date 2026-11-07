import type { H3Event } from 'h3';
import { logger } from '~~/server/utils/logger';

// One catalogue index resolves every slug because backend media routes require public IDs and have no slug filter.
// Per-slug caching would rebuild the same paginated catalogue on every distinct miss.

interface MediaSlugIndex {
  bySlug: Map<string, string>;
  builtAt: number;
}

const TTL_MS = 60 * 60 * 1000;

// Misses refresh newly imported titles before TTL expiry; cooldown bounds scans caused by random-slug probes.
const MISS_REBUILD_COOLDOWN_MS = 60 * 1000;

// Failed background rebuilds leave the index expired; cooldown prevents a full catalogue scan on every request.
const AGE_REBUILD_COOLDOWN_MS = 60 * 1000;

let cached: MediaSlugIndex | null = null;
let lastMissRebuildAt = 0;
let lastAgeRebuildAt = 0;

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

// Catch rejected background refreshes to avoid unhandled rejections; keep serving the previous index.
function refreshInBackground(event?: H3Event): void {
  const now = Date.now();
  if (now - lastAgeRebuildAt < AGE_REBUILD_COOLDOWN_MS) return;
  lastAgeRebuildAt = now;

  void refresh(event).catch((error: unknown) => {
    logger.warn({ err: error }, 'Background media slug index rebuild failed; serving the previous index');
  });
}

// Serve expired hits while refreshing in the background. Misses must await one rebuild because no stale answer exists.
export async function resolveMediaSlug(slug: string, event?: H3Event): Promise<string | null> {
  const now = Date.now();
  const index = cached;

  if (!index) {
    const built = await refresh(event);
    // The just-built index cannot benefit from another miss-triggered scan.
    return built.bySlug.get(slug) ?? null;
  }

  if (now - index.builtAt >= TTL_MS) refreshInBackground(event);

  const hit = index.bySlug.get(slug);
  if (hit) return hit;

  if (now - lastMissRebuildAt < MISS_REBUILD_COOLDOWN_MS) return null;
  lastMissRebuildAt = now;

  // Join any background rebuild instead of starting a second scan.
  const rebuilt = await refresh(event);
  return rebuilt.bySlug.get(slug) ?? null;
}

export function resetMediaSlugIndex(): void {
  cached = null;
  inflight = null;
  lastMissRebuildAt = 0;
  lastAgeRebuildAt = 0;
  lastStaleRebuildAt = 0;
}

// A deleted title can be uploaded again under the same slug with a new publicId. Until the index is rebuilt it
// still hands out the deleted ID, so the caller reports the dead ID here and gets the slug's current one. Only a
// slug the index already knows can reach this, and the cooldown bounds rebuilds the same way misses are bounded.
const STALE_REBUILD_COOLDOWN_MS = 60 * 1000;
let lastStaleRebuildAt = 0;

export async function resolveStaleMediaSlug(
  slug: string,
  deadPublicId: string,
  event?: H3Event,
): Promise<string | null> {
  const current = cached?.bySlug.get(slug);
  if (current && current !== deadPublicId) return current;

  const now = Date.now();
  if (now - lastStaleRebuildAt < STALE_REBUILD_COOLDOWN_MS) return null;
  lastStaleRebuildAt = now;

  const rebuilt = await refresh(event);
  const fresh = rebuilt.bySlug.get(slug);
  return fresh && fresh !== deadPublicId ? fresh : null;
}
