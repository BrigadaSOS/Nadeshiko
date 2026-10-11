import { AppDataSource } from '@config/database';
import { Cache, createCacheNamespace } from '@lib/cache';
import { logger } from '@config/log';

const CACHE = createCacheNamespace('catalogue-size');

/** A day. The catalogue grows by ingest runs, not by the minute, and this is decoration on an email. */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface CatalogueSize {
  sentences: number;
  titles: number;
  hours: number;
}

/** Compute the welcome-email catalogue count live with a small aggregate, not the heavier stats-overview query, so
 * copy does not stale. */
export async function catalogueSize(): Promise<CatalogueSize | null> {
  try {
    return await Cache.getOrCompute(CACHE, 'size', TTL_MS, async () => {
      const rows = (await AppDataSource.query(
        `SELECT
           COUNT(*)::int AS titles,
           COALESCE(SUM(num_segments), 0)::int AS sentences,
           COALESCE(SUM(dialogue_duration_ms), 0)::bigint AS dialogue_ms
         FROM "Media"`,
      )) as Array<{ titles: number; sentences: number; dialogue_ms: string }>;

      const row = rows[0];

      return {
        sentences: Number(row?.sentences ?? 0),
        titles: Number(row?.titles ?? 0),
        hours: Math.round(Number(row?.dialogue_ms ?? 0) / 3_600_000),
      };
    });
  } catch (error) {
    // Return null on catalogue-query failure so a database hiccup drops the optional welcome-email line instead of
    // blocking the email.
    logger.warn({ err: error }, 'Could not read the catalogue size for the welcome email');
    return null;
  }
}
