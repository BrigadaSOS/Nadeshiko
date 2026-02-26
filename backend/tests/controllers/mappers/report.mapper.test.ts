import { describe, it, expect } from 'bun:test';
import {
  toAdminReportDTO,
  toAdminReportFilters,
  toAdminReportListDTO,
  toReportCreateAttributes,
  toReportDTO,
  toReportTargetCountKey,
  toReportUpdatePatch,
} from '@app/controllers/mappers/report.mapper';
import { ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models/Report';

function buildReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source: ReportSource.USER,
    targetType: ReportTargetType.MEDIA,
    targetMediaId: 10,
    targetEpisodeNumber: null,
    targetSegmentUuid: null,
    auditRunId: null,
    reason: ReportReason.OTHER,
    description: null,
    data: null,
    status: ReportStatus.PENDING,
    adminNotes: null,
    userId: 7,
    user: { username: 'reporter' },
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('report.mapper', () => {
  it('maps SEGMENT target and includes optional episode number', () => {
    const dto = toReportDTO(
      buildReport({
        targetType: ReportTargetType.SEGMENT,
        targetMediaId: 20,
        targetEpisodeNumber: 3,
        targetSegmentUuid: 'seg-1',
      }) as any,
    );

    expect(dto.target).toEqual({
      type: 'SEGMENT',
      mediaId: 20,
      segmentUuid: 'seg-1',
      episodeNumber: 3,
    });
  });

  it('maps EPISODE target with required episode number', () => {
    const dto = toReportDTO(
      buildReport({
        targetType: ReportTargetType.EPISODE,
        targetMediaId: 55,
        targetEpisodeNumber: 12,
      }) as any,
    );

    expect(dto.target).toEqual({
      type: 'EPISODE',
      mediaId: 55,
      episodeNumber: 12,
    });
  });

  it('throws when EPISODE target is missing required episode number', () => {
    expect(() =>
      toReportDTO(
        buildReport({
          targetType: ReportTargetType.EPISODE,
          targetMediaId: 55,
          targetEpisodeNumber: null,
        }) as any,
      ),
    ).toThrow('missing targetEpisodeNumber');
  });

  it('maps MEDIA target via default branch', () => {
    const dto = toReportDTO(buildReport({ targetType: ReportTargetType.MEDIA, targetMediaId: 99 }) as any);
    expect(dto.target).toEqual({
      type: 'MEDIA',
      mediaId: 99,
    });
  });

  it('maps admin report with reporter fallback', () => {
    const dto = toAdminReportDTO(buildReport({ user: null }) as any, 4);
    expect(dto.reportCount).toBe(4);
    expect(dto.reporterName).toBe('System');
  });

  it('maps create attributes for segment target', () => {
    const attrs = toReportCreateAttributes({
      userId: 17,
      body: {
        target: {
          type: 'SEGMENT',
          mediaId: 55,
          episodeNumber: 7,
          segmentUuid: 'seg-123',
        },
        reason: 'WRONG_TRANSLATION',
        description: 'needs fix',
      },
    } as any);

    expect(attrs).toMatchObject({
      source: ReportSource.USER,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: 55,
      targetEpisodeNumber: 7,
      targetSegmentUuid: 'seg-123',
      reason: ReportReason.WRONG_TRANSLATION,
      description: 'needs fix',
      userId: 17,
      status: ReportStatus.PENDING,
    });
  });

  it('maps create attributes for media target with nullables', () => {
    const attrs = toReportCreateAttributes({
      userId: 18,
      body: {
        target: {
          type: 'MEDIA',
          mediaId: 42,
        },
        reason: 'OTHER',
      },
    } as any);

    expect(attrs).toMatchObject({
      targetType: ReportTargetType.MEDIA,
      targetMediaId: 42,
      targetEpisodeNumber: null,
      targetSegmentUuid: null,
      description: null,
    });
  });

  it('builds update patch only from defined values', () => {
    const patch = toReportUpdatePatch({
      status: 'ACCEPTED',
    } as any);

    expect(patch).toEqual({
      status: ReportStatus.ACCEPTED,
    });
  });

  it('maps admin report query filters', () => {
    const filters = toAdminReportFilters({
      status: 'CONCERN',
      source: 'AUTO',
      'target.type': 'SEGMENT',
      'target.mediaId': 9,
      'target.episodeNumber': 3,
      'target.segmentUuid': 'seg-9',
      auditRunId: 12,
    } as any);

    expect(filters).toEqual({
      status: ReportStatus.CONCERN,
      source: ReportSource.AUTO,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: 9,
      targetEpisodeNumber: 3,
      targetSegmentUuid: 'seg-9',
      auditRunId: 12,
    });
  });

  it('maps report target count key and admin list dto', () => {
    const one = buildReport({ targetType: ReportTargetType.MEDIA, targetMediaId: 77 }) as any;
    const two = buildReport({ id: 2, targetType: ReportTargetType.MEDIA, targetMediaId: 77 }) as any;
    const countMap = new Map([[toReportTargetCountKey(one), 5]]);

    const list = toAdminReportListDTO([one, two], countMap);
    expect(list).toHaveLength(2);
    expect(list[0].reportCount).toBe(5);
    expect(list[1].reportCount).toBe(5);
  });
});
