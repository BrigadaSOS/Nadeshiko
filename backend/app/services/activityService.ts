import { UserActivity, ActivityType } from '@app/models/UserActivity';
import { User } from '@app/models/User';
import { List, Report } from '@app/models';
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

export async function getUserActivityStats(userId: number) {
  const counts = await UserActivity.createQueryBuilder('a')
    .select('a.activity_type', 'activityType')
    .addSelect('COUNT(*)', 'count')
    .where('a.user_id = :userId', { userId })
    .groupBy('a.activity_type')
    .getRawMany();

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    countMap[row.activityType] = Number(row.count);
  }

  // Calculate streak: consecutive days with activity ending today
  const streakDays = await calculateStreak(userId);

  // Top media by activity count
  const topMedia = await UserActivity.createQueryBuilder('a')
    .select('a.media_id', 'mediaId')
    .addSelect('COUNT(*)', 'count')
    .where('a.user_id = :userId AND a.media_id IS NOT NULL', { userId })
    .groupBy('a.media_id')
    .orderBy('count', 'DESC')
    .limit(10)
    .getRawMany();

  return {
    totalSearches: countMap[ActivityType.SEARCH] || 0,
    totalExports: countMap[ActivityType.ANKI_EXPORT] || 0,
    totalPlays: countMap[ActivityType.SEGMENT_PLAY] || 0,
    totalListAdds: countMap[ActivityType.LIST_ADD_SEGMENT] || 0,
    streakDays,
    topMedia: topMedia.map((r) => ({ mediaId: Number(r.mediaId), count: Number(r.count) })),
  };
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

  const lists = await List.find({
    where: { userId },
    relations: { items: true },
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
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      visibility: l.visibility,
      items: l.items?.map((i) => ({ mediaId: i.mediaId, position: i.position })) || [],
    })),
    reports: reports.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetMediaId: r.targetMediaId,
      targetSegmentUuid: r.targetSegmentUuid,
      reason: r.reason,
      description: r.description,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
