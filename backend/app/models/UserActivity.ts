import { Entity, PrimaryColumn, Column, Index, ManyToOne, JoinColumn, type FindOptionsWhere } from 'typeorm';
import type { User } from './User';
import type { t_OpaqueCursorPagination } from 'generated/models';
import { BaseEntity } from './base.entity';

export enum ActivityType {
  SEARCH = 'SEARCH',
  ANKI_EXPORT = 'ANKI_EXPORT',
  SEGMENT_PLAY = 'SEGMENT_PLAY',
  SHARE = 'SHARE',
}

export interface UserActivityTrackData {
  segmentId?: number;
  mediaId?: number;
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

  @Column({ name: 'segment_id', type: 'int', nullable: true })
  segmentId?: number | null;

  @Column({ name: 'media_id', type: 'int', nullable: true })
  mediaId?: number | null;

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
      mediaId: data.mediaId ?? null,
      searchQuery: data.searchQuery ?? null,
      mediaName: data.mediaName ?? null,
      japaneseText: data.japaneseText ?? null,
    });
  }

  static async listForUser(params: {
    userId: number;
    take: number;
    cursor?: string;
    activityType?: string;
    date?: string;
  }): Promise<{
    activities: UserActivity[];
    pagination: t_OpaqueCursorPagination;
  }> {
    const { items: activities, pagination } = await UserActivity.paginateWithKeyset({
      take: params.take,
      cursor: params.cursor,
      query: () => {
        const qb = UserActivity.createQueryBuilder('activity').where('activity.user_id = :userId', {
          userId: params.userId,
        });

        if (params.activityType) {
          qb.andWhere('activity.activity_type = :activityType', { activityType: params.activityType });
        }
        if (params.date) {
          qb.andWhere('DATE(activity.created_at) = :date', { date: params.date });
        }

        return qb;
      },
    });

    return {
      activities,
      pagination,
    };
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
    topMedia: Array<{ mediaId: number; count: number }>;
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
      .select('activity.media_id', 'mediaId')
      .addSelect('COUNT(*)', 'count')
      .where('activity.user_id = :userId AND activity.media_id IS NOT NULL', { userId })
      .groupBy('activity.media_id')
      .orderBy('count', 'DESC')
      .limit(10);

    if (since) {
      topMediaQb.andWhere('activity.created_at >= :since', { since });
    }

    const topMediaRows = await topMediaQb.getRawMany<{ mediaId: string; count: string }>();

    return {
      totalSearches: countMap[ActivityType.SEARCH] || 0,
      totalExports: countMap[ActivityType.ANKI_EXPORT] || 0,
      totalPlays: countMap[ActivityType.SEGMENT_PLAY] || 0,
      totalListAdds: 0,
      totalShares: countMap[ActivityType.SHARE] || 0,
      topMedia: topMediaRows.map((row) => ({
        mediaId: Number(row.mediaId),
        count: Number(row.count),
      })),
    };
  }

  static async getHeatmapForUser(
    userId: number,
    days: number,
  ): Promise<Record<string, Record<string, number>>> {
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

  static async clearForUser(userId: number, activityType?: string): Promise<number> {
    const where: FindOptionsWhere<UserActivity> = { userId };
    if (activityType) {
      where.activityType = activityType as ActivityType;
    }

    const result = await UserActivity.delete(where);
    return result.affected || 0;
  }
}
