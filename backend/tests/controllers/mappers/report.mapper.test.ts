import { describe, it, expect } from 'bun:test';
import {
  toAdminReportGroupsDTO,
  toReportCreateAttributes,
  toReportDTO,
  toTargetGroupKey,
  toReportUpdatePatch,
  toAdminReportFilters,
} from '@app/controllers/mappers/report.mapper';
import { ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models/Report';

function buildReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source: ReportSource.USER,
    targetType: ReportTargetType.MEDIA,
    targetMediaId: 10,
    targetEpisodeNumber: null,
    targetSegmentId: null,
    auditRunId: null,
    reason: ReportReason.OTHER,
    description: null,
    data: null,
    status: ReportStatus.OPEN,
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
        targetSegmentId: 101,
      }) as any,
      { mediaPublicId: 'pub-20', segmentPublicId: 'pub-101' },
    );

    expect(dto.target).toEqual({
      type: 'SEGMENT',
      mediaId: 'pub-20',
      segmentId: 'pub-101',
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
      { mediaPublicId: 'pub-55' },
    );

    expect(dto.target).toEqual({
      type: 'EPISODE',
      mediaId: 'pub-55',
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
        { mediaPublicId: 'pub-55' },
      ),
    ).toThrow('missing targetEpisodeNumber');
  });

  it('maps MEDIA target via default branch', () => {
    const dto = toReportDTO(buildReport({ targetType: ReportTargetType.MEDIA, targetMediaId: 99 }) as any, {
      mediaPublicId: 'pub-99',
    });
    expect(dto.target).toEqual({
      type: 'MEDIA',
      mediaId: 'pub-99',
    });
  });

  it('maps create attributes for segment target', () => {
    const attrs = toReportCreateAttributes({
      userId: 17,
      resolvedSegmentId: 123,
      resolvedMediaId: 55,
      body: {
        target: {
          type: 'SEGMENT',
          mediaId: 'pub-55',
          episodeNumber: 7,
          segmentId: 'seg-123',
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
      targetSegmentId: 123,
      reason: ReportReason.WRONG_TRANSLATION,
      description: 'needs fix',
      userId: 17,
      status: ReportStatus.OPEN,
    });
  });

  it('maps create attributes for media target with nullables', () => {
    const attrs = toReportCreateAttributes({
      userId: 18,
      resolvedSegmentId: null,
      resolvedMediaId: 42,
      body: {
        target: {
          type: 'MEDIA',
          mediaId: 'pub-42',
        },
        reason: 'OTHER',
      },
    } as any);

    expect(attrs).toMatchObject({
      targetType: ReportTargetType.MEDIA,
      targetMediaId: 42,
      targetEpisodeNumber: null,
      targetSegmentId: null,
      description: null,
    });
  });

  it('builds update patch only from defined values', () => {
    const patch = toReportUpdatePatch({
      status: 'FIXED',
    } as any);

    expect(patch).toEqual({
      status: ReportStatus.FIXED,
    });
  });

  it('maps admin report query filters', () => {
    const filters = toAdminReportFilters({
      status: 'PROCESSING',
      source: 'AUTO',
      'target.type': 'SEGMENT',
      'target.mediaId': 9,
      'target.episodeNumber': 3,
      'target.segmentId': 9,
      auditRunId: 12,
    } as any);

    expect(filters).toEqual({
      statuses: [ReportStatus.PROCESSING],
      source: ReportSource.AUTO,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: 9,
      targetEpisodeNumber: 3,
      targetSegmentId: 9,
      auditRunId: 12,
    });
  });

  it('builds target group key without reason', () => {
    const report = buildReport({ targetType: ReportTargetType.MEDIA, targetMediaId: 77 }) as any;
    expect(toTargetGroupKey(report)).toBe('MEDIA:77::');

    const segReport = buildReport({
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: 20,
      targetEpisodeNumber: 5,
      targetSegmentId: 101,
    }) as any;
    expect(toTargetGroupKey(segReport)).toBe('SEGMENT:20:5:101');
  });

  it('groups reports by target into AdminReportGroup DTOs', () => {
    const rep = buildReport({ targetType: ReportTargetType.MEDIA, targetMediaId: 77 }) as any;
    const member1 = buildReport({
      id: 1,
      targetMediaId: 77,
      reason: ReportReason.WRONG_TRANSLATION,
      description: 'bad subtitle',
      userId: 7,
      user: { username: 'alice' },
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    }) as any;
    const member2 = buildReport({
      id: 2,
      targetMediaId: 77,
      reason: ReportReason.WRONG_AUDIO,
      description: null,
      userId: 8,
      user: { username: 'bob' },
      createdAt: new Date('2025-01-03T00:00:00.000Z'),
    }) as any;

    const groups = toAdminReportGroupsDTO([rep], [member1, member2], {
      media: new Map([[77, { publicId: 'pub-77', nameRomaji: 'Test Show' }]]),
      segments: new Map(),
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].mediaName).toBe('Test Show');
    expect(groups[0].reportCount).toBe(2);
    expect(groups[0].reporterCount).toBe(2);
    expect(groups[0].reports).toHaveLength(2);
    expect(groups[0].reports[0]).toMatchObject({
      id: 1,
      reason: 'WRONG_TRANSLATION',
      description: 'bad subtitle',
      reporterName: 'alice',
    });
    expect(groups[0].reports[1]).toMatchObject({
      id: 2,
      reason: 'WRONG_AUDIO',
      reporterName: 'bob',
    });
  });
});
