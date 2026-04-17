import type { t_Report, t_AdminReportGroup, t_AdminReportGroupItem } from 'generated/models';
import type {
  CreateReportRequestOutput,
  ListAdminReportsQueryOutput,
  UpdateReportRequestOutput,
} from 'generated/outputTypes';
import { In } from 'typeorm';
import type { Report } from '@app/models';
import { Media, Segment, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models';

const requireReportField = <T>(report: Report, field: string, value: T | null | undefined): T => {
  if (value == null) {
    throw new Error(`Report ${report.id} has targetType=${report.targetType} but missing ${field}`);
  }
  return value;
};

type ReportPublicIds = {
  mediaPublicId: string;
  segmentPublicId?: string | null;
};

const toReportTargetDTO = (report: Report, ids: ReportPublicIds): t_Report['target'] => {
  switch (report.targetType) {
    case 'SEGMENT':
      return {
        type: 'SEGMENT',
        mediaPublicId: ids.mediaPublicId,
        segmentPublicId: ids.segmentPublicId ?? null,
        ...(report.targetEpisodeNumber != null ? { episodeNumber: report.targetEpisodeNumber } : {}),
      };
    case 'EPISODE':
      return {
        type: 'EPISODE',
        mediaPublicId: ids.mediaPublicId,
        episodeNumber: requireReportField(report, 'targetEpisodeNumber', report.targetEpisodeNumber),
      };
    default:
      return {
        type: 'MEDIA',
        mediaPublicId: ids.mediaPublicId,
      };
  }
};

export type AdminReportFilters = {
  statuses?: ReportStatus[];
  source?: ReportSource;
  targetType?: ReportTargetType;
  targetMediaId?: number;
  targetEpisodeNumber?: number;
  targetSegmentId?: number;
  auditRunId?: number;
  orphaned?: boolean;
};

export const toReportDTO = (report: Report, ids: ReportPublicIds): t_Report => {
  return {
    id: report.id,
    source: report.source,
    target: toReportTargetDTO(report, ids),
    auditRunId: report.auditRunId ?? null,
    reason: report.reason,
    description: report.description ?? null,
    data: report.data ?? null,
    status: report.status,
    adminNotes: report.adminNotes ?? null,
    userId: report.userId ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt?.toISOString() ?? null,
  };
};

export function toTargetGroupKey(
  report: Pick<Report, 'targetType' | 'targetMediaId' | 'targetEpisodeNumber' | 'targetSegmentId'>,
): string {
  return `${report.targetType}:${report.targetMediaId}:${report.targetEpisodeNumber ?? ''}:${report.targetSegmentId ?? ''}`;
}

type MediaInfo = { publicId: string; nameRomaji: string };
export type ReportPublicIdMaps = { media: ReadonlyMap<number, MediaInfo>; segments: ReadonlyMap<number, string> };

function toGroupItemDTO(report: Report): t_AdminReportGroupItem {
  return {
    id: report.id,
    reason: report.reason,
    description: report.description ?? null,
    source: report.source,
    reporterName: report.user?.username ?? 'System',
    createdAt: report.createdAt.toISOString(),
    adminNotes: report.adminNotes ?? null,
  };
}

export function toAdminReportGroupsDTO(
  groupReps: Report[],
  allReports: Report[],
  publicIdMaps: ReportPublicIdMaps,
): t_AdminReportGroup[] {
  const reportsByTarget = new Map<string, Report[]>();
  for (const report of allReports) {
    const key = toTargetGroupKey(report);
    const list = reportsByTarget.get(key);
    if (list) {
      list.push(report);
    } else {
      reportsByTarget.set(key, [report]);
    }
  }

  return groupReps.map((rep) => {
    const key = toTargetGroupKey(rep);
    const members = reportsByTarget.get(key) ?? [rep];
    const mediaInfo = publicIdMaps.media.get(rep.targetMediaId);
    const ids: ReportPublicIds = {
      mediaPublicId: mediaInfo?.publicId ?? '',
      segmentPublicId: rep.targetSegmentId ? (publicIdMaps.segments.get(rep.targetSegmentId) ?? null) : null,
    };

    const userIds = new Set(members.map((r) => r.userId).filter((id) => id != null));
    const firstCreated = members.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), members[0].createdAt);
    const lastUpdated = members.reduce(
      (max, r) => {
        if (!r.updatedAt) return max;
        return !max || r.updatedAt > max ? r.updatedAt : max;
      },
      null as Date | null,
    );

    return {
      target: toReportTargetDTO(rep, ids),
      mediaName: mediaInfo?.nameRomaji ?? '',
      status: rep.status,
      reportCount: members.length,
      reporterCount: userIds.size,
      firstReportedAt: firstCreated.toISOString(),
      lastStatusChange: lastUpdated?.toISOString() ?? null,
      reports: members.map(toGroupItemDTO),
    };
  });
}

type ReportCreateAttributesInput = {
  body: CreateReportRequestOutput;
  userId: number;
  resolvedSegmentId: number | null;
  resolvedMediaId: number;
};

export function toReportCreateAttributes({
  body,
  userId,
  resolvedSegmentId,
  resolvedMediaId,
}: ReportCreateAttributesInput): Partial<Report> {
  return {
    source: ReportSource.USER,
    targetType: body.target.type as ReportTargetType,
    targetMediaId: resolvedMediaId,
    targetEpisodeNumber: 'episodeNumber' in body.target ? (body.target.episodeNumber ?? null) : null,
    targetSegmentId: resolvedSegmentId,
    reason: body.reason as ReportReason,
    description: body.description ?? null,
    userId,
    status: ReportStatus.OPEN,
  };
}

export function toReportUpdatePatch(body: UpdateReportRequestOutput): Partial<Report> {
  const patch: Partial<Report> = {};
  if (body.status !== undefined) patch.status = body.status as ReportStatus;
  if (body.adminNotes !== undefined) patch.adminNotes = body.adminNotes ?? null;
  return patch;
}

const VALID_STATUSES = new Set(Object.values(ReportStatus));

export function parseStatusFilter(raw?: string): ReportStatus[] | undefined {
  if (!raw) return undefined;
  const statuses = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_STATUSES.has(s as ReportStatus)) as ReportStatus[];
  return statuses.length > 0 ? statuses : undefined;
}

export function toAdminReportFilters(query: ListAdminReportsQueryOutput): AdminReportFilters {
  return {
    statuses: parseStatusFilter(query.status),
    source: query.source as ReportSource | undefined,
    targetType: query['target.type'] as ReportTargetType | undefined,
    targetMediaId: query['target.mediaId'],
    targetEpisodeNumber: query['target.episodeNumber'],
    targetSegmentId: query['target.segmentId'],
    auditRunId: query.auditRunId,
    orphaned: query.orphaned,
  };
}

export async function resolveReportPublicIdsForOne(report: Report): Promise<ReportPublicIds> {
  const media = await Media.findOne({ where: { id: report.targetMediaId }, select: ['publicId'] });
  let segmentPublicId: string | null = null;
  if (report.targetSegmentId) {
    const segment = await Segment.findOne({ where: { id: report.targetSegmentId }, select: ['publicId'] });
    segmentPublicId = segment?.publicId ?? null;
  }
  return { mediaPublicId: media?.publicId ?? '', segmentPublicId };
}

export async function resolveReportPublicIds(reports: Report[]): Promise<ReportPublicIdMaps> {
  const mediaIds = [...new Set(reports.map((r) => r.targetMediaId))];
  const segmentIds = [...new Set(reports.map((r) => r.targetSegmentId).filter((id): id is number => id != null))];

  const [mediaEntries, segmentEntries] = await Promise.all([
    mediaIds.length > 0 ? Media.find({ where: { id: In(mediaIds) }, select: ['id', 'publicId', 'nameRomaji'] }) : [],
    segmentIds.length > 0 ? Segment.find({ where: { id: In(segmentIds) }, select: ['id', 'publicId'] }) : [],
  ]);

  return {
    media: new Map(mediaEntries.map((m) => [m.id, { publicId: m.publicId, nameRomaji: m.nameRomaji }])),
    segments: new Map(segmentEntries.map((s) => [s.id, s.publicId])),
  };
}
