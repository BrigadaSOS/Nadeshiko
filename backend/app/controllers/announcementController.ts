import type { GetAnnouncement, UpdateAnnouncement } from 'generated/routes/admin';
import { Announcement } from '@app/models';
import { Cache, createCacheNamespace } from '@lib/cache';

const ANNOUNCEMENT_CACHE = createCacheNamespace('announcement');
const CACHE_KEY = 'active';
const CACHE_TTL_MS = 60_000;

const NO_ANNOUNCEMENT = Symbol('none');
type CachedAnnouncement =
  | { message: string; type: 'INFO' | 'WARNING' | 'MAINTENANCE'; active: boolean }
  | typeof NO_ANNOUNCEMENT;

export const getAnnouncement: GetAnnouncement = async (_params, respond) => {
  const cached = Cache.get<CachedAnnouncement>(ANNOUNCEMENT_CACHE, CACHE_KEY);
  if (cached !== null) {
    if (cached === NO_ANNOUNCEMENT) return respond.with204();
    return respond.with200().body(cached);
  }

  const row = await Announcement.findOne({ where: { active: true } });
  if (!row) {
    Cache.set(ANNOUNCEMENT_CACHE, CACHE_KEY, NO_ANNOUNCEMENT, CACHE_TTL_MS);
    return respond.with204();
  }

  const result = { message: row.message, type: row.type, active: row.active };
  Cache.set(ANNOUNCEMENT_CACHE, CACHE_KEY, result, CACHE_TTL_MS);
  return respond.with200().body(result);
};


export const updateAnnouncement: UpdateAnnouncement = async ({ body }, respond) => {
  let row = await Announcement.findOne({ where: {} });

  if (row) {
    row.message = body.message;
    row.type = body.type;
    row.active = body.active;
    await row.save();
  } else {
    row = Announcement.create({
      message: body.message,
      type: body.type,
      active: body.active,
    });
    await row.save();
  }

  Cache.invalidate(ANNOUNCEMENT_CACHE);

  return respond.with200().body({
    message: row.message,
    type: row.type,
    active: row.active,
  });
};
