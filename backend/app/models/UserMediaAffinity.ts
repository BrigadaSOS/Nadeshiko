import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './User';
import { AccountQuotaUsage } from './AccountQuotaUsage';
import { ActivityType } from './UserActivity';

export interface FamiliarMediaEntry {
  mediaPublicId: string;
  score: number;
  ankiCount: number;
  playCount: number;
  shareCount: number;
}

/**
 * A monthly tally of how much a reader engages with each title.
 *
 * Deliberately NOT derived from `UserActivity`, for two reasons that both bite.
 * `trackForUser` drops every row when `searchHistory` is off, so anything read
 * off that table inherits a consent decision about a *different* dataset -- and
 * `activityRetentionWorker` deletes activity at 90 days, so familiarity derived
 * from it would quietly reset every quarter, which is precisely wrong for a
 * signal whose whole point is "shows I have known for a while".
 *
 * What is stored here is strictly less than the activity log holds: counts per
 * title per month, no queries, no timestamps, no segment ids. That asymmetry is
 * what lets the tally be offered as its own preference rather than folded into
 * search history.
 *
 * Keyed by `mediaPublicId` rather than a `Media` foreign key: the write sits on
 * the fire-and-forget activity path, where the public id is already in the
 * payload and a foreign key would cost a lookup per event. Rows for deleted
 * media are harmless -- the read joins `Media` and drops what it cannot resolve,
 * and retention prunes the rest.
 */
@Entity('UserMediaAffinity')
@Index(['userId', 'mediaPublicId', 'periodYyyymm'], { unique: true })
@Index(['periodYyyymm'])
export class UserMediaAffinity extends BaseEntity {
  /** Read-time weights: raw counts are stored, so these retune without a backfill. */
  static readonly WEIGHTS = { anki: 8, share: 3, play: 2 } as const;
  static readonly WINDOW_MONTHS = 12;
  /** One Anki export clears this; a couple of stray plays do not. */
  static readonly MIN_SCORE = 5;
  static readonly MAX_RESULTS = 20;

  /**
   * Which counter each activity type feeds. A literal map, not a computed name:
   * the column is interpolated into SQL below, and this is what keeps that safe.
   * `SEARCH` is absent on purpose -- searching for a title is not evidence you
   * know it, and scoped searches do carry a media id.
   */
  static readonly COUNTER_COLUMNS: Partial<Record<ActivityType, string>> = {
    [ActivityType.ANKI_EXPORT]: 'anki_count',
    [ActivityType.SEGMENT_PLAY]: 'play_count',
    [ActivityType.SHARE]: 'share_count',
  };

  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'media_public_id', type: 'varchar' })
  mediaPublicId!: string;

  @Column({ name: 'period_yyyymm', type: 'int' })
  periodYyyymm!: number;

  @Column({ name: 'anki_count', type: 'int', default: 0 })
  ankiCount!: number;

  @Column({ name: 'play_count', type: 'int', default: 0 })
  playCount!: number;

  @Column({ name: 'share_count', type: 'int', default: 0 })
  shareCount!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /**
   * Anki exports weigh heaviest because exporting is deliberate mining. Plays
   * are scaled logarithmically rather than counted: a play fires per segment, so
   * an autoplaying playlist would otherwise bury a month of study under one idle
   * evening. `autoplay` is filtered at the door too, but the curve is what holds
   * when an older client omits that flag -- 100 plays is worth ~13 points, still
   * under two exports.
   */
  static scoreFor(counts: Pick<FamiliarMediaEntry, 'ankiCount' | 'playCount' | 'shareCount'>): number {
    const { anki, share, play } = UserMediaAffinity.WEIGHTS;
    return counts.ankiCount * anki + counts.shareCount * share + Math.log2(1 + counts.playCount) * play;
  }

  /** The `WINDOW_MONTHS` most recent period keys, newest first. */
  static recentPeriods(now = new Date()): number[] {
    const periods: number[] = [];
    for (let offset = 0; offset < UserMediaAffinity.WINDOW_MONTHS; offset++) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      periods.push(AccountQuotaUsage.getCurrentPeriodYyyymm(date));
    }
    return periods;
  }

  /**
   * A STATEMENT RATHER THAN THE QUERY BUILDER, for the same reason
   * `AccountQuotaUsage.incrementForUser` is one: TypeORM's `orUpdate()` only
   * names columns to overwrite with the INSERT's values, so it would write
   * `count = 1` on every collision -- a counter silently degraded to a flag.
   * Read-then-write would instead lose increments whenever two events for the
   * same title land together, which on a playlist is the normal case.
   *
   * The unqualified column on the right-hand side is the EXISTING row, per
   * Postgres' ON CONFLICT rules; `excluded` would be the rejected insert.
   */
  static async incrementForUser(userId: number, mediaPublicId: string, activityType: ActivityType): Promise<void> {
    const column = UserMediaAffinity.COUNTER_COLUMNS[activityType];
    if (!column) return;

    const periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm();
    const repository = UserMediaAffinity.getRepository();
    const table = repository.metadata.tableName;

    await repository.query(
      `INSERT INTO "${table}" ("user_id", "media_public_id", "period_yyyymm", "${column}")
       VALUES ($1, $2, $3, 1)
       ON CONFLICT ("user_id", "media_public_id", "period_yyyymm") DO UPDATE
          SET "${column}" = "${table}"."${column}" + 1,
              "updated_at" = CURRENT_TIMESTAMP`,
      [userId, mediaPublicId, periodYyyymm],
    );
  }

  /**
   * The reader's most-studied titles inside the window, highest score first.
   *
   * Ties break alphabetically by public id so the order is stable between calls
   * -- the client sorts a filter list by this ranking, and a ranking that
   * reshuffles on every reload would look like a bug.
   */
  static async getFamiliarForUser(userId: number): Promise<FamiliarMediaEntry[]> {
    const rows = await UserMediaAffinity.createQueryBuilder('affinity')
      .select('affinity.media_public_id', 'mediaPublicId')
      .addSelect('SUM(affinity.anki_count)', 'ankiCount')
      .addSelect('SUM(affinity.play_count)', 'playCount')
      .addSelect('SUM(affinity.share_count)', 'shareCount')
      .where('affinity.user_id = :userId', { userId })
      .andWhere('affinity.period_yyyymm IN (:...periods)', { periods: UserMediaAffinity.recentPeriods() })
      .groupBy('affinity.media_public_id')
      .getRawMany<{ mediaPublicId: string; ankiCount: string; playCount: string; shareCount: string }>();

    return rows
      .map((row) => {
        const counts = {
          ankiCount: Number(row.ankiCount),
          playCount: Number(row.playCount),
          shareCount: Number(row.shareCount),
        };
        return { mediaPublicId: row.mediaPublicId, score: UserMediaAffinity.scoreFor(counts), ...counts };
      })
      .filter((entry) => entry.score >= UserMediaAffinity.MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.mediaPublicId.localeCompare(b.mediaPublicId))
      .slice(0, UserMediaAffinity.MAX_RESULTS);
  }

  static async clearForUser(userId: number): Promise<number> {
    const result = await UserMediaAffinity.delete({ userId });
    return result.affected || 0;
  }
}
