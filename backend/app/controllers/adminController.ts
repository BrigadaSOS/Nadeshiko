import type { GetAdminHealth, GetAdminDashboard, TriggerReindex } from 'generated/routes/admin';
import type { t_TriggerReindexRequestBodySchema } from 'generated/models';
import { getStuckJobs } from '@app/workers/queueAdmin';
import { toAdminQueueStatsDTO } from '@app/controllers/mappers/queue.mapper';
import { Cache } from '@lib/cache';
import { client as esClient, INDEX_NAME } from '@config/elasticsearch';
import { SegmentDocument, type ReindexMediaItem } from '@app/models/SegmentDocument';
import { AppDataSource } from '@config/database';
import { UserActivity } from '@app/models/UserActivity';
import { config } from '@config/config';
import packageJson from '../../package.json';

const API_VERSION = config.APP_VERSION === '0.0.0' ? packageJson.version : config.APP_VERSION;

type ElasticsearchHealth = {
  status: 'connected' | 'disconnected';
  version: string | null;
  clusterName: string | null;
  clusterStatus: string | null;
  indexName: string | null;
  documentCount: number | null;
};

type DatabaseHealth = {
  status: 'connected' | 'disconnected';
  version: string | null;
};

export const getAdminHealth: GetAdminHealth = async (_params, respond) => {
  const [esHealth, dbHealth] = await Promise.all([checkElasticsearch(), checkDatabase()]);
  const status = resolveSystemStatus(esHealth, dbHealth);

  return respond.with200().body({
    status,
    app: { version: API_VERSION },
    elasticsearch: esHealth,
    database: dbHealth,
  });
};

export const getAdminDashboard: GetAdminDashboard = async (_params, respond) => {
  const [media, users, activity, esHealth, dbHealth, queues] = await Promise.all([
    getMediaStats(),
    getUserStats(),
    getActivityStats(),
    checkElasticsearch(),
    checkDatabase(),
    getStuckJobs(),
  ]);

  return respond.with200().body({
    media,
    users,
    activity,
    system: {
      status: resolveSystemStatus(esHealth, dbHealth),
      app: { version: API_VERSION },
      elasticsearch: esHealth,
      database: dbHealth,
      queues: toAdminQueueStatsDTO(queues),
    },
  });
};

export const triggerReindex: TriggerReindex = async ({ body }, respond) => {
  const result = await SegmentDocument.reindex(toReindexMediaItems(body));
  Cache.invalidate(SegmentDocument.SEARCH_STATS_CACHE);

  return respond.with200().body(result);
};

function resolveSystemStatus(esHealth: ElasticsearchHealth, dbHealth: DatabaseHealth): 'healthy' | 'degraded' {
  return esHealth.status === 'connected' && dbHealth.status === 'connected' ? 'healthy' : 'degraded';
}

function toReindexMediaItems(body: t_TriggerReindexRequestBodySchema | undefined): ReindexMediaItem[] | undefined {
  return body?.media?.map((item) => ({
    mediaId: item.mediaId,
    episodes: item.episodes,
  }));
}

async function checkElasticsearch(): Promise<ElasticsearchHealth> {
  try {
    const [info, health, count] = await Promise.all([
      esClient.info(),
      esClient.cluster.health(),
      esClient.count({ index: INDEX_NAME }),
    ]);

    return {
      status: 'connected',
      version: info.version.number,
      clusterName: health.cluster_name,
      clusterStatus: health.status,
      indexName: INDEX_NAME,
      documentCount: count.count,
    };
  } catch {
    return {
      status: 'disconnected',
      version: null,
      clusterName: null,
      clusterStatus: null,
      indexName: null,
      documentCount: null,
    };
  }
}

async function checkDatabase(): Promise<DatabaseHealth> {
  try {
    const result = await AppDataSource.query('SELECT version()');

    return {
      status: 'connected',
      version: extractDatabaseVersion(result[0]?.version),
    };
  } catch {
    return {
      status: 'disconnected',
      version: null,
    };
  }
}

function extractDatabaseVersion(fullVersion: unknown): string | null {
  if (typeof fullVersion !== 'string' || fullVersion.trim().length === 0) {
    return null;
  }

  const version = fullVersion.split(' ').slice(0, 2).join(' ');
  return version.length > 0 ? version : null;
}

async function getMediaStats() {
  const [mediaCount, episodeCount, segmentTotal, characterCount, seiyuuCount] = await Promise.all([
    queryCount('SELECT COUNT(*)::int AS count FROM "Media"'),
    queryCount('SELECT COUNT(*)::int AS count FROM "Episode"'),
    queryCount('SELECT COUNT(*)::int AS count FROM "Segment"'),
    queryCount('SELECT COUNT(*)::int AS count FROM "Character"'),
    queryCount('SELECT COUNT(*)::int AS count FROM "Seiyuu"'),
  ]);

  return {
    totalMedia: mediaCount,
    totalEpisodes: episodeCount,
    totalSegments: segmentTotal,
    totalCharacters: characterCount,
    totalSeiyuu: seiyuuCount,
  };
}

async function getUserStats() {
  const [totalUsers, recentlyRegistered, recentlyActive] = await Promise.all([
    queryCount('SELECT COUNT(*)::int AS count FROM "User"'),
    queryCount('SELECT COUNT(*)::int AS count FROM "User" WHERE created_at > NOW() - INTERVAL \'30 days\''),
    queryCount('SELECT COUNT(*)::int AS count FROM "User" WHERE last_login > NOW() - INTERVAL \'30 days\''),
  ]);

  return {
    totalUsers,
    recentlyRegisteredCount: recentlyRegistered,
    recentlyActiveCount: recentlyActive,
  };
}

async function queryCount(sql: string): Promise<number> {
  const result = await AppDataSource.query(sql);
  const count = Number(result[0]?.count ?? 0);
  return Number.isFinite(count) ? count : 0;
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
    totalSearches: countMap.SEARCH ?? 0,
    totalExports: countMap.ANKI_EXPORT ?? 0,
    totalPlays: countMap.SEGMENT_PLAY ?? 0,
    totalCollectionAdds: countMap.COLLECTION_ADD ?? 0,
    activeSearchers7d: Number(activeSearchers?.count ?? 0),
    topQueries7d: topQueries.map((row) => ({ query: row.query as string, count: Number(row.count) })),
    dailyActivity30d: dailyActivity.map((row) => ({ date: row.date as string, count: Number(row.count) })),
  };
}
