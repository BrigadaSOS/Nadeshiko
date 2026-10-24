import type { Announcement } from '@brigadasos/nadeshiko-sdk';
import { logger } from '~~/server/utils/logger';
import { useServerSdk } from '~~/server/utils/sdk';

// Shared banner data is SWR-cached here rather than fetched on every render. One minute keeps maintenance
// notices prompt. The key ignores the query string, which the handler never reads, so junk parameters cannot
// mint cache entries. Wrap null: bare null becomes an empty 204 rather than the JSON body callers expect.
const handler = defineEventHandler(async (event): Promise<{ announcement: Announcement | null }> => {
  try {
    const data = await useServerSdk(event).getAnnouncement();
    if (!data || !('active' in data)) return { announcement: null };
    return { announcement: { message: data.message, type: data.type, active: data.active } as Announcement };
  } catch (error) {
    // No announcement and upstream failure both degrade to no banner; cache the quiet case instead of failing the page.
    logger.warn({ err: error }, 'Announcement lookup failed; rendering no banner');
    return { announcement: null };
  }
});

export default defineCachedEventHandler(handler, {
  name: 'announcement',
  swr: true,
  maxAge: 60,
  getKey: () => 'current',
});
