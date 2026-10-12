import type { Announcement } from '@brigadasos/nadeshiko-sdk';
import { logger } from '~~/server/utils/logger';
import { useServerSdk } from '~~/server/utils/sdk';

// Shared banner data is SWR-cached through this Nitro route rather than fetched on every render.
// Wrap null: bare null becomes an empty 204 rather than the JSON body callers expect.
export default defineEventHandler(async (event): Promise<{ announcement: Announcement | null }> => {
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
