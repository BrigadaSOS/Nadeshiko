import type { GetAdminDashboard } from 'generated/routes/admin';
import { checkElasticsearch, checkDatabase } from '@app/services/systemHealth';
import { getStuckJobs } from '@app/workers/pgBoss';
import { AppDataSource } from '@config/database';
import { UserActivity } from '@app/models/UserActivity';

const API_VERSION = '1.4.0';

async function getMediaStats() {
  const [mediaCount, episodeCount, segmentTotal, characterCount, seiyuuCount] = await Promise.all([
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "Media"'),
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "Episode"'),
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "Segment"'),
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "Character"'),
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "Seiyuu"'),
  ]);

  return {
    totalMedia: mediaCount[0].count,
    totalEpisodes: episodeCount[0].count,
    totalSegments: segmentTotal[0].count,
    totalCharacters: characterCount[0].count,
    totalSeiyuu: seiyuuCount[0].count,
  };
}

async function getUserStats() {
  const [totalUsers, recentlyRegistered, recentlyActive] = await Promise.all([
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "User"'),
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "User" WHERE created_at > NOW() - INTERVAL \'30 days\''),
    AppDataSource.query('SELECT COUNT(*)::int AS count FROM "User" WHERE last_login > NOW() - INTERVAL \'30 days\''),
  ]);

  return {
    totalUsers: totalUsers[0].count,
    recentlyRegisteredCount: recentlyRegistered[0].count,
    recentlyActiveCount: recentlyActive[0].count,
  };
}

async function getActivityStats() {
  const counts = await UserActivity.createQueryBuilder('a')
    .select('a.activity_type', 'activityType')
    .addSelect('COUNT(*)', 'count')
    .groupBy('a.activity_type')
    .getRawMany();

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    countMap[row.activityType] = Number(row.count);
  }

  const activeSearchers = await UserActivity.createQueryBuilder('a')
    .select('COUNT(DISTINCT a.user_id)', 'count')
    .where("a.activity_type = 'SEARCH' AND a.created_at > NOW() - INTERVAL '7 days'")
    .getRawOne();

  const topQueries = await UserActivity.createQueryBuilder('a')
    .select('a.search_query', 'query')
    .addSelect('COUNT(*)', 'count')
    .where("a.activity_type = 'SEARCH' AND a.search_query IS NOT NULL AND a.created_at > NOW() - INTERVAL '7 days'")
    .groupBy('a.search_query')
    .orderBy('count', 'DESC')
    .limit(10)
    .getRawMany();

  const dailyActivity = await UserActivity.createQueryBuilder('a')
    .select("TO_CHAR(DATE(a.created_at), 'YYYY-MM-DD')", 'date')
    .addSelect('COUNT(*)', 'count')
    .where("a.created_at > NOW() - INTERVAL '30 days'")
    .groupBy('DATE(a.created_at)')
    .orderBy('date', 'ASC')
    .getRawMany();

  return {
    totalSearches: countMap.SEARCH || 0,
    totalExports: countMap.ANKI_EXPORT || 0,
    totalPlays: countMap.SEGMENT_PLAY || 0,
    totalCollectionAdds: countMap.LIST_ADD_SEGMENT || 0,
    activeSearchers7d: Number(activeSearchers?.count || 0),
    topQueries7d: topQueries.map((r) => ({ query: r.query as string, count: Number(r.count) })),
    dailyActivity30d: dailyActivity.map((r) => ({ date: r.date as string, count: Number(r.count) })),
  };
}

export const getAdminDashboard: GetAdminDashboard = async (_params, respond) => {
  const [media, users, activity, esHealth, dbHealth, queues] = await Promise.all([
    getMediaStats(),
    getUserStats(),
    getActivityStats(),
    checkElasticsearch(),
    checkDatabase(),
    getStuckJobs(),
  ]);

  const status = esHealth.status === 'connected' && dbHealth.status === 'connected' ? 'healthy' : 'degraded';

  return respond.with200().body({
    media,
    users,
    activity,
    system: {
      status,
      app: { version: API_VERSION },
      elasticsearch: esHealth,
      database: dbHealth,
      queues,
    },
  });
};
