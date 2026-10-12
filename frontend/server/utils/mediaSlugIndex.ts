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
}
