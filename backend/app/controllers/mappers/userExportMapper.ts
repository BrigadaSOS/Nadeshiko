import type { t_UserExportCollection, t_UserExportResponse } from 'generated/models';
import type { User } from '@app/models/User';
import type { UserActivity } from '@app/models/UserActivity';
import type { Collection } from '@app/models';
import type { Report } from '@app/models';
import { toCollectionDTO } from './collectionMapper';
import { type ReportPublicIdMaps, toReportDTO } from './reportMapper';
import { toUserActivityDTO } from './activityMapper';

export const toExportCollectionDTO = (collection: Collection): t_UserExportCollection => ({
  ...toCollectionDTO(collection, collection.segmentItems?.length ?? 0),
  segmentIds:
    collection.segmentItems
      ?.slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => s.segmentId) || [],
});

export const toUserExportDTO = (
  user: User,
  activity: UserActivity[],
  collections: Collection[],
  reports: Report[],
  publicIdMaps: ReportPublicIdMaps,
): t_UserExportResponse => ({
  profile: {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  },
  preferences: user.preferences || {},
  activity: activity.map(toUserActivityDTO),
  collections: collections.map(toExportCollectionDTO),
  reports: reports.map((report) =>
    toReportDTO(report, {
      mediaPublicId: publicIdMaps.media.get(report.targetMediaId)?.publicId ?? '',
      segmentPublicId: report.targetSegmentId ? (publicIdMaps.segments.get(report.targetSegmentId) ?? null) : null,
    }),
  ),
});
