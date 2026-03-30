import type { NextFunction, Request, Response } from 'express';
import type {
  GetAdminDashboardOverview,
  GetAdminDashboardMedia,
  GetAdminDashboardActivity,
  GetAdminDashboardCollections,
  GetAdminDashboardApiKeys,
  GetAdminDashboardSystem,
} from 'generated/routes/admin';
import { getStuckJobs } from '@app/workers/queueAdmin';
import { toAdminQueueStatsDTO } from '@app/controllers/mappers/queue.mapper';
import { Cache, createCacheNamespace } from '@lib/cache';
import { client as esClient, INDEX_NAME } from '@config/elasticsearch';
import { AppDataSource } from '@config/database';
import { UserActivity } from '@app/models/UserActivity';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import packageJson from '../../package.json';
import { queryCount, fillDailyRange, checkDatabase, resolveSystemStatus } from '@app/controllers/adminController';

const API_VERSION = packageJson.version;
const CACHE = createCacheNamespace('adminDashboard');

const FIVE_MINUTES = 5 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function parseDays(raw: string | undefined): number {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

export const getAdminDashboardOverview: GetAdminDashboardOverview = async ({ query }, respond) => {
  const days = parseDays(query.days);
  const cacheKey = `overview:${days}`;
  const cached = Cache.get(CACHE, cacheKey);
  if (cached) return respond.with200().body(cached as any);

  const [media, users, activity] = await Promise.all([getMediaStats(), getUserStats(), getActivityOverview(days)]);

  const body = { media, users, activity };
  Cache.set(CACHE, cacheKey, body, FIVE_MINUTES);
  return respond.with200().body(body);
};

export const getAdminDashboardMedia: GetAdminDashboardMedia = async (_params, respond) => {
  const cacheKey = 'media';
  const cached = Cache.get(CACHE, cacheKey);
  if (cached) return respond.with200().body(cached as any);

  const [
    byCategory,
    byFormat,
    byStatus,
    byGenre,
    byStudio,
    segmentsByContentRating,
    segmentsByStatus,
    topMediaByPlays,
    topMediaBySearches,
    topMediaByExports,
  ] = await Promise.all([
    queryLabelCount('SELECT category AS label, COUNT(*)::int AS count FROM "Media" GROUP BY category'),
    queryLabelCount(
      'SELECT airing_format AS label, COUNT(*)::int AS count FROM "Media" WHERE airing_format IS NOT NULL GROUP BY airing_format ORDER BY count DESC',
    ),
    queryLabelCount(
      'SELECT airing_status AS label, COUNT(*)::int AS count FROM "Media" WHERE airing_status IS NOT NULL GROUP BY airing_status ORDER BY count DESC',
    ),
    queryLabelCount(
      'SELECT g AS label, COUNT(*)::int AS count FROM "Media", UNNEST(genres) AS g GROUP BY g ORDER BY count DESC LIMIT 15',
    ),
    queryLabelCount(
      'SELECT studio AS label, COUNT(*)::int AS count FROM "Media" WHERE studio IS NOT NULL GROUP BY studio ORDER BY count DESC LIMIT 15',
    ),
    queryLabelCount(
      'SELECT content_rating AS label, COUNT(*)::int AS count FROM "Segment" GROUP BY content_rating ORDER BY count DESC',
    ),
    queryLabelCount(
      'SELECT status AS label, COUNT(*)::int AS count FROM "Segment" GROUP BY status ORDER BY count DESC',
    ),
    queryTopMedia('SEGMENT_PLAY'),
    queryTopMedia('SEARCH'),
    queryTopMedia('ANKI_EXPORT'),
  ]);

  const body = {
    byCategory,
    byFormat,
    byStatus,
    byGenre,
    byStudio,
    segmentsByContentRating,
    segmentsByStatus,
    topMediaByPlays,
    topMediaBySearches,
    topMediaByExports,
  };
  Cache.set(CACHE, cacheKey, body, ONE_HOUR);
  return respond.with200().body(body);
};

export const getAdminDashboardActivity: GetAdminDashboardActivity = async ({ query }, respond) => {
  const days = parseDays(query.days);
  const cacheKey = `activity:${days}`;
  const cached = Cache.get(CACHE, cacheKey);
  if (cached) return respond.with200().body(cached as any);

  const [dailyActivityByType, topSearches, dailyExports, topExportedMedia] = await Promise.all([
    getDailyActivityByType(days),
    getTopSearches(days),
    getDailyExports(days),
    getTopExportedMedia(days),
  ]);

  const body = { dailyActivityByType, topSearches, dailyExports, topExportedMedia };
  Cache.set(CACHE, cacheKey, body, FIVE_MINUTES);
  return respond.with200().body(body);
};

export const getAdminDashboardCollections: GetAdminDashboardCollections = async (_params, respond) => {
  const cacheKey = 'collections';
  const cached = Cache.get(CACHE, cacheKey);
  if (cached) return respond.with200().body(cached as any);

  const [totalCollections, byTypeAndVisibility, averageSize, topCollections] = await Promise.all([
    queryCount('SELECT COUNT(*)::int AS count FROM "Collection"'),
    AppDataSource.query(
      'SELECT collection_type AS type, visibility, COUNT(*)::int AS count FROM "Collection" GROUP BY collection_type, visibility ORDER BY count DESC',
    ),
    AppDataSource.query(
      'SELECT COALESCE(AVG(cnt), 0) AS avg FROM (SELECT COUNT(*)::int AS cnt FROM "CollectionSegment" GROUP BY collection_id) sub',
    ),
    AppDataSource.query(
      `SELECT c.id, c.name, c.collection_type AS type, c.visibility, COUNT(cs.id)::int AS "segmentCount"
       FROM "Collection" c
       JOIN "CollectionSegment" cs ON cs.collection_id = c.id
       GROUP BY c.id
       ORDER BY "segmentCount" DESC
       LIMIT 10`,
    ),
  ]);

  const body = {
    totalCollections,
    byTypeAndVisibility: byTypeAndVisibility.map((r: { type: string; visibility: string; count: number }) => ({
      type: r.type,
      visibility: r.visibility,
      count: Number(r.count),
    })),
    averageSize: Number(averageSize[0]?.avg ?? 0),
    topCollections: topCollections.map(
      (r: { id: number; name: string; type: string; visibility: string; segmentCount: number }) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        visibility: r.visibility,
        segmentCount: Number(r.segmentCount),
      }),
    ),
  };
  Cache.set(CACHE, cacheKey, body, FIFTEEN_MINUTES);
  return respond.with200().body(body);
};

export const getAdminDashboardApiKeys: GetAdminDashboardApiKeys = async (_params, respond) => {
  const cacheKey = 'apiKeys';
  const cached = Cache.get(CACHE, cacheKey);
  if (cached) return respond.with200().body(cached as any);

  const periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm();
  const keys = await AppDataSource.query(
    `SELECT a.id, a.name, a.hint, a.is_active AS "isActive",
            u.username, u.email,
            COALESCE(q.request_count, 0)::int AS "requestCount"
     FROM "ApiAuth" a
     LEFT JOIN "User" u ON u.id = a.user_id
     LEFT JOIN "AccountQuotaUsage" q ON q.user_id = a.user_id AND q.period_yyyymm = $1
     ORDER BY "requestCount" DESC`,
    [periodYyyymm],
  );

  const body = {
    keys: keys.map(
      (r: {
        id: number;
        name: string | null;
        hint: string | null;
        isActive: boolean;
        username: string | null;
        email: string | null;
        requestCount: number;
      }) => ({
        id: r.id,
        name: r.name,
        hint: r.hint,
        isActive: r.isActive,
        username: r.username,
        email: r.email,
        requestCount: Number(r.requestCount),
      }),
    ),
  };
  Cache.set(CACHE, cacheKey, body, FIVE_MINUTES);
  return respond.with200().body(body);
};

export const getAdminDashboardSystem: GetAdminDashboardSystem = async (_params, respond) => {
  const [esHealth, dbHealth, queues] = await Promise.all([
    checkElasticsearchWithSize(),
    checkDatabase(),
    getStuckJobs(),
  ]);

  return respond.with200().body({
    status: resolveSystemStatus(esHealth, dbHealth),
    app: { version: API_VERSION },
    elasticsearch: esHealth,
    database: dbHealth,
    queues: toAdminQueueStatsDTO(queues),
  });
};

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
    queryCount(
      'SELECT COUNT(DISTINCT user_id)::int AS count FROM "UserActivity" WHERE created_at > NOW() - INTERVAL \'30 days\'',
    ),
  ]);

  return { totalUsers, recentlyRegisteredCount: recentlyRegistered, recentlyActiveCount: recentlyActive };
}

async function getActivityOverview(days: number) {
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

  const dailyActivityRows = await UserActivity.createQueryBuilder('a')
    .select("TO_CHAR(DATE(a.created_at), 'YYYY-MM-DD')", 'date')
    .addSelect('COUNT(*)', 'count')
    .where(`a.created_at > NOW() - INTERVAL '${days} days'`)
    .groupBy('DATE(a.created_at)')
    .orderBy('date', 'ASC')
    .getRawMany();

  const dailyActivityMap = new Map(dailyActivityRows.map((row) => [row.date as string, Number(row.count)]));
  const dailyActivity = fillDailyRange(days, dailyActivityMap);

  return {
    totalSearches: countMap.SEARCH ?? 0,
    totalExports: countMap.ANKI_EXPORT ?? 0,
    totalPlays: countMap.SEGMENT_PLAY ?? 0,
    totalShares: countMap.SHARE ?? 0,
    activeSearchers7d: Number(activeSearchers?.count ?? 0),
    dailyActivity,
  };
}

async function queryLabelCount(sql: string): Promise<Array<{ label: string; count: number }>> {
  const rows = await AppDataSource.query(sql);
  return rows.map((r: { label: string; count: number }) => ({
    label: String(r.label ?? 'Unknown'),
    count: Number(r.count),
  }));
}

async function queryTopMedia(
  activityType: string,
): Promise<Array<{ mediaId: number; mediaName: string; count: number }>> {
  const rows = await UserActivity.createQueryBuilder('a')
    .select('a.media_id', 'mediaId')
    .addSelect('a.anime_name', 'mediaName')
    .addSelect('COUNT(*)', 'count')
    .where('a.activity_type = :activityType AND a.media_id IS NOT NULL', { activityType })
    .groupBy('a.media_id')
    .addGroupBy('a.anime_name')
    .orderBy('count', 'DESC')
    .limit(10)
    .getRawMany();

  return rows.map((r) => ({
    mediaId: Number(r.mediaId),
    mediaName: String(r.mediaName ?? 'Unknown'),
    count: Number(r.count),
  }));
}

async function getDailyActivityByType(days: number) {
  const rows = await AppDataSource.query(
    `SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') AS date, activity_type, COUNT(*)::int AS count
     FROM "UserActivity"
     WHERE created_at > NOW() - INTERVAL '${days} days'
     GROUP BY DATE(created_at), activity_type
     ORDER BY date ASC`,
  );

  const grouped = new Map<string, { search: number; ankiExport: number; segmentPlay: number; share: number }>();
  for (const row of rows) {
    let entry = grouped.get(row.date);
    if (!entry) {
      entry = { search: 0, ankiExport: 0, segmentPlay: 0, share: 0 };
      grouped.set(row.date, entry);
    }
    const count = Number(row.count);
    switch (row.activity_type) {
      case 'SEARCH':
        entry.search = count;
        break;
      case 'ANKI_EXPORT':
        entry.ankiExport = count;
        break;
      case 'SEGMENT_PLAY':
        entry.segmentPlay = count;
        break;
      case 'SHARE':
        entry.share = count;
        break;
    }
  }

  const today = new Date();
  const result: Array<{ date: string; search: number; ankiExport: number; segmentPlay: number; share: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push({ date: dateStr, ...(grouped.get(dateStr) ?? { search: 0, ankiExport: 0, segmentPlay: 0, share: 0 }) });
  }

  return result;
}

async function getTopSearches(days: number): Promise<Array<{ query: string; count: number }>> {
  const rows = await UserActivity.createQueryBuilder('a')
    .select('a.search_query', 'query')
    .addSelect('COUNT(*)', 'count')
    .where(
      `a.activity_type = 'SEARCH' AND a.search_query IS NOT NULL AND a.created_at > NOW() - INTERVAL '${days} days'`,
    )
    .groupBy('a.search_query')
    .orderBy('count', 'DESC')
    .limit(10)
    .getRawMany();

  return rows.map((r) => ({ query: r.query as string, count: Number(r.count) }));
}

async function getDailyExports(days: number): Promise<Array<{ date: string; count: number }>> {
  const rows = await UserActivity.createQueryBuilder('a')
    .select("TO_CHAR(DATE(a.created_at), 'YYYY-MM-DD')", 'date')
    .addSelect('COUNT(*)', 'count')
    .where(`a.activity_type = 'ANKI_EXPORT' AND a.created_at > NOW() - INTERVAL '${days} days'`)
    .groupBy('DATE(a.created_at)')
    .orderBy('date', 'ASC')
    .getRawMany();

  const exportMap = new Map(rows.map((row) => [row.date as string, Number(row.count)]));
  return fillDailyRange(days, exportMap);
}

async function getTopExportedMedia(
  days: number,
): Promise<Array<{ mediaId: number; mediaName: string; count: number }>> {
  const rows = await UserActivity.createQueryBuilder('a')
    .select('a.media_id', 'mediaId')
    .addSelect('a.anime_name', 'mediaName')
    .addSelect('COUNT(*)', 'count')
    .where(
      `a.activity_type = 'ANKI_EXPORT' AND a.media_id IS NOT NULL AND a.created_at > NOW() - INTERVAL '${days} days'`,
    )
    .groupBy('a.media_id')
    .addGroupBy('a.anime_name')
    .orderBy('count', 'DESC')
    .limit(10)
    .getRawMany();

  return rows.map((r) => ({
    mediaId: Number(r.mediaId),
    mediaName: String(r.mediaName ?? 'Unknown'),
    count: Number(r.count),
  }));
}

export const getAdminUsersWithProviders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const searchCondition = search ? `AND (u.email ILIKE $3 OR u.username ILIKE $3)` : '';
    const params: (string | number)[] = [limit, offset];
    if (search) params.push(`%${search}%`);

    const rows = await AppDataSource.query(
      `SELECT
        u.id,
        u.username AS name,
        u.email,
        u.role,
        u.is_verified AS "emailVerified",
        u.banned,
        u.ban_reason AS "banReason",
        u.created_at AS "createdAt",
        u.modified_at AS "updatedAt",
        COALESCE(
          array_agg(DISTINCT a.provider_id) FILTER (WHERE a.provider_id IS NOT NULL),
          ARRAY[]::text[]
        ) AS providers
      FROM "User" u
      LEFT JOIN account a ON a.user_id = u.id
      WHERE u.is_active = true ${searchCondition}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
      params,
    );

    const [{ count }] = await AppDataSource.query(
      `SELECT COUNT(*) AS count FROM "User" u WHERE u.is_active = true ${search ? 'AND (u.email ILIKE $1 OR u.username ILIKE $1)' : ''}`,
      search ? [`%${search}%`] : [],
    );

    res.json({ users: rows, total: Number(count) });
  } catch (err) {
    next(err);
  }
};

async function checkElasticsearchWithSize() {
  try {
    const [info, health, count, stats] = await Promise.all([
      esClient.info(),
      esClient.cluster.health(),
      esClient.count({ index: INDEX_NAME }),
      esClient.indices.stats({ index: INDEX_NAME }),
    ]);

    const indexSizeBytes = stats.indices?.[INDEX_NAME]?.total?.store?.size_in_bytes ?? null;

    return {
      status: 'connected' as const,
      version: info.version.number,
      clusterName: health.cluster_name,
      clusterStatus: health.status,
      indexName: INDEX_NAME,
      documentCount: count.count,
      indexSizeBytes,
    };
  } catch {
    return {
      status: 'disconnected' as const,
      version: null,
      clusterName: null,
      clusterStatus: null,
      indexName: null,
      documentCount: null,
      indexSizeBytes: null,
    };
  }
}
