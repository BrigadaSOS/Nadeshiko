import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  type FindOptionsWhere,
  type SelectQueryBuilder,
} from 'typeorm';
import type { User } from './User';
import { BaseEntity } from './base.entity';
import { blankToNull } from '@lib/utils/blank';

export enum ActivityType {
  SEARCH = 'SEARCH',
  ANKI_EXPORT = 'ANKI_EXPORT',
  SEGMENT_PLAY = 'SEGMENT_PLAY',
  SHARE = 'SHARE',
}

interface UserActivityTrackData {
  segmentId?: string;
  mediaPublicId?: string;
  searchQuery?: string;
  mediaName?: string;
  japaneseText?: string;
}

@Entity('UserActivity')
@Index(['userId', 'createdAt'])
@Index(['userId', 'activityType'])
export class UserActivity extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'activity_type', type: 'enum', enum: ActivityType })
  activityType!: ActivityType;

  @Column({ name: 'segment_id', type: 'varchar', nullable: true })
  segmentId?: string | null;

  @Column({ name: 'media_public_id', type: 'varchar', nullable: true })
  mediaPublicId?: string | null;

  @Column({ name: 'search_query', type: 'varchar', nullable: true })
  searchQuery?: string | null;

  @Column({ name: 'anime_name', type: 'varchar', nullable: true })
  mediaName?: string | null;

  @Column({ name: 'japanese_text', type: 'varchar', nullable: true })
  japaneseText?: string | null;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  static async trackForUser(
    user: Pick<User, 'id' | 'preferences'>,
    activityType: ActivityType,
    data: UserActivityTrackData,
  ): Promise<void> {
    if (user.preferences?.searchHistory?.enabled === false) {
      return;
    }

    // `blankToNull`, not `?? null`: clients that have no name for the media send
    // `''` rather than omitting the field, and `??` only catches the omission.
    // The stored `''` then fails the response schema's `minLength: 1` and 500s
    // every read of the timeline it lands in -- so it is refused at the door.
    const fields = {
      segmentId: blankToNull(data.segmentId),
      mediaPublicId: blankToNull(data.mediaPublicId),
      searchQuery: blankToNull(data.searchQuery),
      mediaName: blankToNull(data.mediaName),
      japaneseText: blankToNull(data.japaneseText),
    };

    if (activityType === ActivityType.SEARCH && fields.searchQuery) {
      const bumped = await UserActivity.bumpSearchForToday(user.id, fields.searchQuery, fields.mediaPublicId);
      if (bumped) return;
    }

    await UserActivity.save({ userId: user.id, activityType, ...fields });
  }

  /**
   * Moves today's row for this search to now, and says whether there was one.
   *
   * Running the same search twice is not two searches worth remembering. A
   * SEARCH is recorded on ARRIVAL rather than on submit -- which is what makes
   * a shared link, a dictionary-extension link and a plain reload all count --
   * and that is exactly why the same query piled up a row per visit: the
   * client-side guard against repeats is a ref, so it resets on every mount.
   * The timeline showed the same word over and over and `totalSearches` counted
   * each one.
   *
   * SCOPED TO THE DAY, and the day is the point. Collapsing a query outright
   * would move it off the date it was first run onto the date it was last run,
   * and `getHeatmapForUser` counts rows per `DATE(created_at)` -- so a word
   * looked up every morning would light one square instead of a week of them.
   * A repeat within the day is the noise; a repeat tomorrow is a fact about
   * tomorrow. The recents menu under the search bar collapses across days on
   * its own (`dedupeRecents`), so it still shows one entry either way.
   *
   * Only SEARCH. Playing a clip or exporting a card twice really is two events,
   * and `UserMediaAffinity` counts them as such.
   *
   * `created_at` is what moves: it is what the timeline orders by and what
   * `searchedAt` in the recents menu reads, so a repeat has to surface as
   * recent. Everything else on the row is left as first recorded.
   */
  private static async bumpSearchForToday(
    userId: number,
    searchQuery: string,
    mediaPublicId: string | null,
  ): Promise<boolean> {
    // `clock_timestamp()`, not `CURRENT_TIMESTAMP`/`now()`: those two are the
    // TRANSACTION's start time and do not move within one, so a bump could write
    // back the value it just read and claim the row had been touched. Wall-clock
    // is what "you ran this again just now" means, and it is the difference
    // between this being testable and only appearing to work.
    const query = UserActivity.createQueryBuilder()
      .update(UserActivity)
      .set({ createdAt: () => 'clock_timestamp()' })
      .where('user_id = :userId', { userId })
      .andWhere('activity_type = :activityType', { activityType: ActivityType.SEARCH })
      .andWhere('search_query = :searchQuery', { searchQuery })
      // `DATE(created_at)` is the expression `getHeatmapForUser` groups by, so
      // "the same day" means the same thing to both of them.
      .andWhere('DATE(created_at) = DATE(clock_timestamp())');

    // A search across everything and the same search inside a title are two
    // different searches, and `NULL = NULL` is not true in SQL -- so the unscoped
    // case has to be asked for as `IS NULL` rather than compared.
    if (mediaPublicId) {
      query.andWhere('media_public_id = :mediaPublicId', { mediaPublicId });
    } else {
      query.andWhere('media_public_id IS NULL');
    }

    const result = await query.execute();
    return (result.affected ?? 0) > 0;
  }

  static async getStatsForUser(
    userId: number,
    since?: Date,
  ): Promise<{
    totalSearches: number;
    totalExports: number;
    totalPlays: number;
    totalListAdds: number;
    totalShares: number;
    topMedia: Array<{ mediaPublicId: string; count: number }>;
  }> {
    const countsQb = UserActivity.createQueryBuilder('activity')
      .select('activity.activity_type', 'activityType')
      .addSelect('COUNT(*)', 'count')
      .where('activity.user_id = :userId', { userId })
      .groupBy('activity.activity_type');

    if (since) {
      countsQb.andWhere('activity.created_at >= :since', { since });
    }

    const counts = await countsQb.getRawMany<{ activityType: string; count: string }>();
    const countMap: Record<string, number> = {};
    for (const row of counts) {
      countMap[row.activityType] = Number(row.count);
    }

    const topMediaQb = UserActivity.createQueryBuilder('activity')
      .select('activity.media_public_id', 'mediaPublicId')
      .addSelect('COUNT(*)', 'count')
      .where('activity.user_id = :userId AND activity.media_public_id IS NOT NULL', { userId })
      .groupBy('activity.media_public_id')
      .orderBy('count', 'DESC')
      .limit(10);

    if (since) {
      topMediaQb.andWhere('activity.created_at >= :since', { since });
    }

    const topMediaRows = await topMediaQb.getRawMany<{ mediaPublicId: string; count: string }>();

    return {
      totalSearches: countMap[ActivityType.SEARCH] || 0,
      totalExports: countMap[ActivityType.ANKI_EXPORT] || 0,
      totalPlays: countMap[ActivityType.SEGMENT_PLAY] || 0,
      totalListAdds: 0,
      totalShares: countMap[ActivityType.SHARE] || 0,
      topMedia: topMediaRows.map((row) => ({
        mediaPublicId: row.mediaPublicId,
        count: Number(row.count),
      })),
    };
  }

  static async getHeatmapForUser(userId: number, days: number): Promise<Record<string, Record<string, number>>> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const rows = await UserActivity.createQueryBuilder('activity')
      .select("TO_CHAR(DATE(activity.created_at), 'YYYY-MM-DD')", 'day')
      .addSelect('activity.activity_type', 'activityType')
      .addSelect('COUNT(*)', 'count')
      .where('activity.user_id = :userId', { userId })
      .andWhere('activity.created_at >= :since', { since })
      .groupBy('DATE(activity.created_at)')
      .addGroupBy('activity.activity_type')
      .getRawMany<{ day: string; activityType: string; count: string }>();

    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      let dayCounts = result[row.day];
      if (!dayCounts) {
        dayCounts = {};
        result[row.day] = dayCounts;
      }
      dayCounts[row.activityType] = Number(row.count);
    }
    return result;
  }

  static buildUserQuery(
    userId: number,
    filters: { activityType?: string; date?: string },
  ): SelectQueryBuilder<UserActivity> {
    const qb = UserActivity.createQueryBuilder('activity').where('activity.user_id = :userId', { userId });
    if (filters.activityType) {
      qb.andWhere('activity.activity_type = :activityType', { activityType: filters.activityType });
    }
    if (filters.date) {
      qb.andWhere('DATE(activity.created_at) = :date', { date: filters.date });
    }
    return qb;
  }

  static async deleteForUserByDate(userId: number, date: string): Promise<number> {
    const result = await UserActivity.createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId })
      .andWhere('DATE(created_at) = :date', { date })
      .execute();
    return result.affected || 0;
  }

  static async clearForUser(userId: number, activityType?: string): Promise<number> {
    const where: FindOptionsWhere<UserActivity> = { userId };
    if (activityType) {
      where.activityType = activityType as ActivityType;
    }

    const result = await UserActivity.delete(where);
    return result.affected || 0;
  }
}
