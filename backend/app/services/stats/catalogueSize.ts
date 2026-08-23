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

/**
 * How big the catalogue is right now, for the one line of the welcome email
 * that makes a claim about scale.
 *
 * LIVE RATHER THAN WRITTEN INTO THE COPY, because a number in a template is
 * wrong the week after somebody writes it, and wrong in the direction that
 * undersells: the catalogue only grows. The cost is one cheap aggregate a day.
 *
 * A DELIBERATELY SMALLER QUERY THAN `getStatsOverview`, which also computes word
 * coverage across seven frequency tiers over the whole `WordFrequency` table.
 * That is the right query for the stats page and far too much for a decoration;
 * these three numbers come from one scan of `Media`, which is 319 rows.
 */
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
    // NULL RATHER THAN A THROW, and the caller drops the line. The welcome email
    // is the reader's first minute with the account; a database hiccup while
    // counting anime titles must not be the reason it does not arrive.
    logger.warn({ err: error }, 'Could not read the catalogue size for the welcome email');
    return null;
  }
}
