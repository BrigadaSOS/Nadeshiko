import type { Announcement } from '@brigadasos/nadeshiko-sdk';
import { logger } from '~~/server/utils/logger';
import { useServerSdk } from '~~/server/utils/sdk';

/**
 * The site-wide announcement banner.
 *
 * A Nitro route rather than an SDK call from the component, for one reason: the
 * banner is identical for every visitor and changes on the order of days, but
 * calling the backend straight out of `useAsyncData` left nowhere to put that
 * fact. Every render of the home page asked again. Behind a route, `swr` in
 * `nuxt.config.ts` answers ~every request from the cache and refreshes in the
 * background, so the backend sees roughly one call a minute no matter the load.
 *
 * Same shape the component used to build for itself, so nothing downstream of
 * `announcement?.active` had to change.
 */
/**
 * Wrapped rather than returned bare, because "no announcement" is the common
 * case: a handler returning `null` is a 204 with no body, which arrives at the
 * caller as an empty string and makes a liar of the declared return type. An
 * object always has a body to parse.
 */
export default defineEventHandler(async (event): Promise<{ announcement: Announcement | null }> => {
  try {
    const data = await useServerSdk(event).getAnnouncement();
    if (!data || !('active' in data)) return { announcement: null };
    return { announcement: { message: data.message, type: data.type, active: data.active } as Announcement };
  } catch (error) {
    // "No announcement" is served as an error by this endpoint, so a failure here
    // is indistinguishable from the ordinary empty case and must not become a 5xx:
    // the banner is purely additive chrome. Returning null also means the quiet
    // case is what gets cached, rather than re-asking on every render.
    logger.warn({ err: error }, 'Announcement lookup failed; rendering no banner');
    return { announcement: null };
  }
});
