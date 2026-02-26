import type { ExportUserData } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User } from '@app/models/User';
import { UserActivity } from '@app/models/UserActivity';
import { Collection, CollectionSegment, Report } from '@app/models';
import { toUserExportDTO } from './mappers/userExport.mapper';

const EXPORT_BATCH_SIZE = 1000;

export const exportUserData: ExportUserData = async (_params, respond, req) => {
  const user = assertUser(req);

  const [fullUser, activity, collections, reports] = await Promise.all([
    User.findOneOrFail({ where: { id: user.id } }),
    loadUserActivityForExport(user.id),
    loadCollectionsForExport(user.id),
    loadUserReportsForExport(user.id),
  ]);

  return respond.with200().body(toUserExportDTO(fullUser, activity, collections, reports));
};

async function loadUserActivityForExport(userId: number): Promise<UserActivity[]> {
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

    if (batch.length < EXPORT_BATCH_SIZE) {
      break;
    }

    const last = batch[batch.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return activity;
}

async function loadUserReportsForExport(userId: number): Promise<Report[]> {
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

    if (batch.length < EXPORT_BATCH_SIZE) {
      break;
    }

    const last = batch[batch.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return reports;
}

async function loadCollectionsForExport(userId: number): Promise<Collection[]> {
  const collections: Collection[] = [];
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

    if (batch.length < EXPORT_BATCH_SIZE) {
      break;
    }

    cursorId = batch[batch.length - 1].id;
  }

  if (collections.length === 0) {
    return collections;
  }

  const collectionIds = collections.map((collection) => collection.id);
  const collectionSegments = await loadCollectionSegments(collectionIds);
  const segmentsByCollectionId = groupSegmentsByCollectionId(collectionSegments);

  for (const collection of collections) {
    collection.segmentItems = segmentsByCollectionId.get(collection.id) ?? [];
  }

  return collections;
}

async function loadCollectionSegments(collectionIds: number[]): Promise<CollectionSegment[]> {
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
      .getMany();
    allSegments.push(...batch);
  }

  return allSegments;
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
