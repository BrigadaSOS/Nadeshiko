import { UserActivity, ActivityType } from '@app/models/UserActivity';
import { User } from '@app/models/User';
import { Collection, Report } from '@app/models';
import type { FindOptionsWhere } from 'typeorm';

interface TrackActivityData {
  segmentUuid?: string;
  mediaId?: number;
  searchQuery?: string;
}

export async function trackActivity(user: User, type: ActivityType, data: TrackActivityData): Promise<void> {
  if (user.preferences?.searchHistory?.enabled === false) return;

  const activity = new UserActivity();
  activity.userId = user.id;
  activity.activityType = type;
  activity.segmentUuid = data.segmentUuid ?? null;
  activity.mediaId = data.mediaId ?? null;
  activity.searchQuery = data.searchQuery ?? null;

  await activity.save();
}

export async function getUserActivityStats(userId: number, since?: Date) {
  const countsQb = UserActivity.createQueryBuilder('a')
    .select('a.activity_type', 'activityType')
    .addSelect('COUNT(*)', 'count')
    .where('a.user_id = :userId', { userId })
    .groupBy('a.activity_type');

  if (since) {
    countsQb.andWhere('a.created_at >= :since', { since });
  }

  const counts = await countsQb.getRawMany();

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    countMap[row.activityType] = Number(row.count);
  }

  // Streak is always all-time
  const streakDays = await calculateStreak(userId);

  const topMediaQb = UserActivity.createQueryBuilder('a')
    .select('a.media_id', 'mediaId')
    .addSelect('COUNT(*)', 'count')
    .where('a.user_id = :userId AND a.media_id IS NOT NULL', { userId })
    .groupBy('a.media_id')
    .orderBy('count', 'DESC')
    .limit(10);

  if (since) {
    topMediaQb.andWhere('a.created_at >= :since', { since });
  }

  const topMedia = await topMediaQb.getRawMany();

  return {
    totalSearches: countMap[ActivityType.SEARCH] || 0,
    totalExports: countMap[ActivityType.ANKI_EXPORT] || 0,
    totalPlays: countMap[ActivityType.SEGMENT_PLAY] || 0,
    totalListAdds: countMap[ActivityType.LIST_ADD_SEGMENT] || 0,
    streakDays,
    topMedia: topMedia.map((r) => ({ mediaId: Number(r.mediaId), count: Number(r.count) })),
  };
}

export async function getActivityHeatmap(
  userId: number,
  days: number,
  activityType?: string,
): Promise<Record<string, number>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const qb = UserActivity.createQueryBuilder('a')
    .select('DATE(a.created_at)', 'day')
    .addSelect('COUNT(*)', 'count')
    .where('a.user_id = :userId', { userId })
    .andWhere('a.created_at >= :since', { since })
    .groupBy('DATE(a.created_at)');

  if (activityType) {
    qb.andWhere('a.activity_type = :activityType', { activityType });
  }

  const rows = await qb.getRawMany();

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.day] = Number(row.count);
  }
  return counts;
}

async function calculateStreak(userId: number): Promise<number> {
  const result = await UserActivity.createQueryBuilder('a')
    .select('DATE(a.created_at)', 'day')
    .where('a.user_id = :userId', { userId })
    .groupBy('DATE(a.created_at)')
    .orderBy('day', 'DESC')
    .getRawMany();

  if (result.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < result.length; i++) {
    const day = new Date(result[i].day);
    day.setHours(0, 0, 0, 0);

    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);
    expectedDate.setHours(0, 0, 0, 0);

    if (day.getTime() === expectedDate.getTime()) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export async function clearUserActivity(userId: number, type?: string): Promise<number> {
  const where: FindOptionsWhere<UserActivity> = { userId };
  if (type) {
    where.activityType = type as ActivityType;
  }

  const result = await UserActivity.delete(where);
  return result.affected || 0;
}

export async function exportAllUserData(userId: number) {
  const user = await User.findOneOrFail({ where: { id: userId } });

  const activity = await UserActivity.find({
    where: { userId },
    order: { createdAt: 'DESC' },
  });

  const collections = await Collection.find({
    where: { userId },
    relations: { segmentItems: true },
  });

  const reports = await Report.find({
    where: { userId },
    order: { createdAt: 'DESC' },
  });

  return {
    profile: {
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    },
    preferences: user.preferences || {},
    activity: activity.map((a) => ({
      id: a.id,
      activityType: a.activityType,
      segmentUuid: a.segmentUuid,
      mediaId: a.mediaId,
      searchQuery: a.searchQuery,
      createdAt: a.createdAt.toISOString(),
    })),
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      userId: c.userId,
      visibility: c.visibility,
      segmentUuids:
        c.segmentItems
          ?.slice()
          .sort((a, b) => a.position - b.position)
          .map((s) => s.segmentUuid) || [],
    })),
    reports: reports.map((r) => ({
      id: r.id,
      source: r.source,
      target:
        r.targetType === 'SEGMENT'
          ? {
              type: 'SEGMENT' as const,
              mediaId: r.targetMediaId,
              segmentUuid: r.targetSegmentUuid ?? '',
              ...(r.targetEpisodeNumber != null ? { episodeNumber: r.targetEpisodeNumber } : {}),
            }
          : r.targetType === 'EPISODE'
            ? {
                type: 'EPISODE' as const,
                mediaId: r.targetMediaId,
                episodeNumber: r.targetEpisodeNumber ?? 0,
              }
            : {
                type: 'MEDIA' as const,
                mediaId: r.targetMediaId,
              },
      reviewCheckRunId: r.reviewCheckRunId ?? null,
      reason: r.reason,
      description: r.description ?? null,
      data: r.data ?? null,
      status: r.status,
      adminNotes: r.adminNotes ?? null,
      userId: r.userId ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt?.toISOString() ?? null,
    })),
  };
}
