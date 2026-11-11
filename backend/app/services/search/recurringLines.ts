import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import { SegmentStatus } from '@app/models';

/**
 * Which segments search leaves out as repeats of a recurring line.
 *
 * Openings, endings, recaps and previews put the same lines in many episodes of a title, and a search for one of
 * their words would otherwise return the same line once per episode. The rule, over the title's ACTIVE segments:
 *
 *   1. The exact Japanese line appears in at least `MIN_EPISODES` episodes of the title; its copy in the earliest of
 *      those episodes is always kept. Only later copies can be repeats.
 *   2. A later copy is a repeat when it is part of a recurring sequence -- the pair it forms with the line before or
 *      after it also appears, consecutively, in at least `MIN_EPISODES` episodes -- or when it is long
 *      (`MIN_LONE_LENGTH` characters or more), since a long line repeated word for word is narration (a preview or a
 *      recap), not conversation.
 *
 * Short everyday lines said at different moments (はい, ありがとう) are not repeats: they recur, but never as part of
 * the same sequence. Measured on production (2026-11-11): this hides 5,196 segments where the previous rule -- every
 * later copy of a line in 3+ episodes -- hid 28,824, mostly such everyday lines; samples put ~90% of what it hides as
 * openings/endings/previews or reused scenes, and ~96% of what it no longer hides as ordinary dialogue.
 *
 * Computed at write time per title (it depends on every episode of the title) and stored in `Segment.recurring_repeat`,
 * which the indexer copies into Elasticsearch so search filters on it without querying Postgres.
 */
export const RECURRING_MIN_EPISODES = 3;
export const RECURRING_MIN_LONE_LENGTH = 15;

/** Namespace for the per-title advisory lock, so two recomputes of one title never interleave. */
const ADVISORY_LOCK_NAMESPACE = 0x6e616465; // "nade"

/**
 * Recomputes `recurring_repeat` for every segment of one title and returns the ids whose value changed, which need
 * their search document rewritten. Only changed rows are written. Non-ACTIVE segments are always false, so a segment
 * that is hidden and later reactivated starts clean.
 */
export async function recomputeRecurringRepeats(mediaId: number): Promise<number[]> {
  return AppDataSource.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [ADVISORY_LOCK_NAMESPACE, mediaId]);

    const rows: Array<{ id: number }> = await manager.query(
      `WITH s AS (
         SELECT id, episode, position, content, char_length(content) AS len
           FROM "Segment"
          WHERE media_id = $1 AND status = $2::segment_status
       ),
       seq AS (
         SELECT s.*,
                lag(content) OVER e AS prev_content,
                lead(content) OVER e AS next_content
           FROM s
         WINDOW e AS (PARTITION BY episode ORDER BY position)
       ),
       lines AS (
         SELECT content, min(episode) AS first_episode
           FROM s
          GROUP BY content
         HAVING count(DISTINCT episode) >= $3
       ),
       pairs AS (
         SELECT content AS a, next_content AS b
           FROM seq
          WHERE next_content IS NOT NULL
          GROUP BY content, next_content
         HAVING count(DISTINCT episode) >= $3
       ),
       computed AS (
         SELECT seq.id,
                (lines.content IS NOT NULL
                  AND seq.episode > lines.first_episode
                  AND (with_next.a IS NOT NULL OR with_prev.a IS NOT NULL OR seq.len >= $4)) AS repeat
           FROM seq
           LEFT JOIN lines ON lines.content = seq.content
           LEFT JOIN pairs with_next ON with_next.a = seq.content AND with_next.b = seq.next_content
           LEFT JOIN pairs with_prev ON with_prev.a = seq.prev_content AND with_prev.b = seq.content
       ),
       set_active AS (
         UPDATE "Segment" AS t
            SET recurring_repeat = computed.repeat
           FROM computed
          WHERE t.id = computed.id
            AND t.recurring_repeat IS DISTINCT FROM computed.repeat
         RETURNING t.id
       ),
       clear_inactive AS (
         UPDATE "Segment" AS t
            SET recurring_repeat = false
          WHERE t.media_id = $1
            AND t.status <> $2::segment_status
            AND t.recurring_repeat
         RETURNING t.id
       )
       SELECT id FROM set_active
       UNION ALL
       SELECT id FROM clear_inactive`,
      [mediaId, SegmentStatus.ACTIVE, RECURRING_MIN_EPISODES, RECURRING_MIN_LONE_LENGTH],
    );

    const changed = rows.map((row) => Number(row.id));
    if (changed.length > 0) logger.info({ mediaId, changed: changed.length }, 'Recomputed recurring-line repeats');
    return changed;
  });
}
