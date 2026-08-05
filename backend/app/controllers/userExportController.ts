import type { ExportUserData } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User } from '@app/models/User';
import { UserActivity } from '@app/models/UserActivity';
import { Collection, CollectionSegment, Report } from '@app/models';
import { toUserExportDTO } from './mappers/userExportMapper';
import { resolveReportPublicIds } from './mappers/reportMapper';

const EXPORT_BATCH_SIZE = 1000;

/**
 * The paged loops below bound each query, not the response: everything they read accumulates
 * in one array and is serialized as a single JSON body, so the batch size is a politeness to
 * Postgres and nothing more. These are the actual bound. An export that reaches one of them
 * is cut short and says so in `truncated`, which beats both an unbounded body and a response
 * that silently claims to be complete.
 */
const EXPORT_MAX_ACTIVITY = 50_000;
const EXPORT_MAX_REPORTS = 5_000;
const EXPORT_MAX_COLLECTIONS = 1_000;
const EXPORT_MAX_COLLECTION_SEGMENTS = 50_000;

interface Paged<T> {
  items: T[];
  truncated: boolean;
}

export const exportUserData: ExportUserData = async (_params, respond, req) => {
  const user = assertUser(req);

  const [fullUser, activity, collections, reports] = await Promise.all([
    User.findOneOrFail({ where: { id: user.id } }),
    loadUserActivityForExport(user.id),
    loadCollectionsForExport(user.id),
    loadUserReportsForExport(user.id),
  ]);

  const publicIdMaps = await resolveReportPublicIds(reports.items);
  return respond.with200().body(
    toUserExportDTO(fullUser, activity.items, collections.items, reports.items, publicIdMaps, {
      activity: activity.truncated,
      collections: collections.truncated,
      collectionSegments: collections.segmentsTruncated,
      reports: reports.truncated,
    }),
  );
};

async function loadUserActivityForExport(userId: number): Promise<Paged<UserActivity>> {
  const activity: UserActivity[] = [];
  let cursor: { createdAt: Date; id: number } | null = null;

  while (true) {
    const qb = UserActivity.createQueryBuilder('activity')
      .where('activity.user_id = :userId', { userId })
      .orderBy('activity.created_at', 'DESC')
      .addOrderBy('activity.id', 'DESC')
      .take(EXPORT_BATCH_SIZE);

    if (cursor) {
      qb.andWhere(
        '(activity.created_at < :cursorCreatedAt OR (activity.created_at = :cursorCreatedAt AND activity.id < :cursorId))',
        { cursorCreatedAt: cursor.createdAt.toISOString(), cursorId: cursor.id },
      );
    }

    const batch = await qb.getMany();
    activity.push(...batch);
    const exhausted = batch.length < EXPORT_BATCH_SIZE;

    if (activity.length >= EXPORT_MAX_ACTIVITY) {
      return {
        items: activity.slice(0, EXPORT_MAX_ACTIVITY),
        truncated: !exhausted || activity.length > EXPORT_MAX_ACTIVITY,
      };
    }

    if (exhausted) {
      break;
    }

    const last = batch[batch.length - 1];
    if (!last) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return { items: activity, truncated: false };
}

async function loadUserReportsForExport(userId: number): Promise<Paged<Report>> {
  const reports: Report[] = [];
  let cursor: { createdAt: Date; id: number } | null = null;

  while (true) {
    const qb = Report.createQueryBuilder('report')
      .where('report.user_id = :userId', { userId })
      .orderBy('report.created_at', 'DESC')
      .addOrderBy('report.id', 'DESC')
      .take(EXPORT_BATCH_SIZE);

    if (cursor) {
      qb.andWhere(
        '(report.created_at < :cursorCreatedAt OR (report.created_at = :cursorCreatedAt AND report.id < :cursorId))',
        { cursorCreatedAt: cursor.createdAt.toISOString(), cursorId: cursor.id },
      );
    }

    const batch = await qb.getMany();
    reports.push(...batch);
    const exhausted = batch.length < EXPORT_BATCH_SIZE;

    if (reports.length >= EXPORT_MAX_REPORTS) {
      return {
        items: reports.slice(0, EXPORT_MAX_REPORTS),
        truncated: !exhausted || reports.length > EXPORT_MAX_REPORTS,
      };
    }

    if (exhausted) {
      break;
    }

    const last = batch[batch.length - 1];
    if (!last) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return { items: reports, truncated: false };
}

async function loadCollectionsForExport(userId: number): Promise<Paged<Collection> & { segmentsTruncated: boolean }> {
  const collections: Collection[] = [];
  let truncated = false;
  let cursorId: number | null = null;

  while (true) {
    const qb = Collection.createQueryBuilder('collection')
      .where('collection.user_id = :userId', { userId })
      .orderBy('collection.id', 'ASC')
      .take(EXPORT_BATCH_SIZE);

    if (cursorId !== null) {
      qb.andWhere('collection.id > :cursorId', { cursorId });
    }

    const batch = await qb.getMany();
    collections.push(...batch);
    const exhausted = batch.length < EXPORT_BATCH_SIZE;

    if (collections.length >= EXPORT_MAX_COLLECTIONS) {
      truncated = !exhausted || collections.length > EXPORT_MAX_COLLECTIONS;
      collections.length = Math.min(collections.length, EXPORT_MAX_COLLECTIONS);
      break;
    }

    if (exhausted) {
      break;
    }

    const last = batch[batch.length - 1];
    if (!last) break;
    cursorId = last.id;
  }

  if (collections.length === 0) {
    return { items: collections, truncated, segmentsTruncated: false };
  }

  const collectionIds = collections.map((collection) => collection.id);
  const { items: collectionSegments, truncated: segmentsTruncated } = await loadCollectionSegments(collectionIds);
  const segmentsByCollectionId = groupSegmentsByCollectionId(collectionSegments);

  for (const collection of collections) {
    collection.segmentItems = segmentsByCollectionId.get(collection.id) ?? [];
  }

  return { items: collections, truncated, segmentsTruncated };
}

async function loadCollectionSegments(collectionIds: number[]): Promise<Paged<CollectionSegment>> {
  const allSegments: CollectionSegment[] = [];

  for (let i = 0; i < collectionIds.length; i += EXPORT_BATCH_SIZE) {
    const idBatch = collectionIds.slice(i, i + EXPORT_BATCH_SIZE);
    if (idBatch.length === 0) {
      continue;
    }

    const batch = await CollectionSegment.createQueryBuilder('segment')
      .where('segment.collection_id IN (:...collectionIds)', { collectionIds: idBatch })
      .orderBy('segment.collection_id', 'ASC')
      .addOrderBy('segment.position', 'ASC')
      .addOrderBy('segment.id', 'ASC')
      .take(EXPORT_MAX_COLLECTION_SEGMENTS - allSegments.length + 1)
      .getMany();
    allSegments.push(...batch);

    if (allSegments.length > EXPORT_MAX_COLLECTION_SEGMENTS) {
      return { items: allSegments.slice(0, EXPORT_MAX_COLLECTION_SEGMENTS), truncated: true };
    }
  }

  return { items: allSegments, truncated: false };
}

function groupSegmentsByCollectionId(segments: CollectionSegment[]): Map<number, CollectionSegment[]> {
  const byCollectionId = new Map<number, CollectionSegment[]>();

  for (const segment of segments) {
    const existing = byCollectionId.get(segment.collectionId);
    if (existing) {
      existing.push(segment);
      continue;
    }
    byCollectionId.set(segment.collectionId, [segment]);
  }

  return byCollectionId;
}
