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

export enum ActivityType {
  SEARCH = 'SEARCH',
  ANKI_EXPORT = 'ANKI_EXPORT',
  SEGMENT_PLAY = 'SEGMENT_PLAY',
  SHARE = 'SHARE',
}

export interface UserActivityTrackData {
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

    await UserActivity.save({
      userId: user.id,
      activityType,
      segmentId: data.segmentId ?? null,
      mediaPublicId: data.mediaPublicId ?? null,
      searchQuery: data.searchQuery ?? null,
      mediaName: data.mediaName ?? null,
      japaneseText: data.japaneseText ?? null,
    });
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
      if (!result[row.day]) result[row.day] = {};
      result[row.day][row.activityType] = Number(row.count);
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
