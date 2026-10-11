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

/** Keep familiarity separate from activity: it survives activity retention and stores only monthly title counts,
 * with no queries or timestamps. */
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

  /** Use a literal counter-column map for safe SQL interpolation; omit SEARCH because finding a title is not
   * evidence of familiarity. */
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

  /** Exports weigh more than plays; play counts are logarithmic because one autoplayed playlist emits one event per
   * segment. */
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

  /** Use a SQL upsert statement so increments are atomic; TypeORM `orUpdate()` would overwrite a collision with
   * `count = 1` instead of adding. */
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

  /** Rank by score, then public id for stable ties; the client uses this order to build its familiar-title filter. */
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

  /** Delete forgotten rows rather than zeroing them; forgetting is not a blocklist, so later activity starts a fresh
   * tally. */
  static async forgetForUser(userId: number, mediaPublicId: string): Promise<number> {
    const result = await UserMediaAffinity.delete({ userId, mediaPublicId });
    return result.affected || 0;
  }
}
