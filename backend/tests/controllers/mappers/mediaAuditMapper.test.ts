import { describe, expect, it } from 'bun:test';
import {
  toAdminMediaAuditListDTO,
  toMediaAuditDTO,
  toMediaAuditRunDTO,
  toMediaAuditRunsDTO,
  toRunAuditResponseDTO,
  toThresholdDefaults,
} from '@app/controllers/mappers/mediaAuditMapper';
import { MediaAuditTargetType } from '@app/models';

describe('mediaAudit.mapper', () => {
  it('builds threshold defaults from schema fields', () => {
    const defaults = toThresholdDefaults([
      { key: 'ratio', label: 'Ratio', type: 'number', default: 0.2, min: 0, max: 1 },
      { key: 'enabledFlag', label: 'Enabled flag', type: 'boolean', default: true },
    ]);

    expect(defaults).toEqual({
      ratio: 0.2,
      enabledFlag: true,
    });
  });

  it('maps media audit dto with registry metadata and latest run', () => {
    const dto = toMediaAuditDTO(
      {
        id: 12,
        name: 'lowSegmentMedia',
        label: 'DB label',
        description: 'DB description',
        targetType: MediaAuditTargetType.MEDIA,
        threshold: { minAvgSegmentsPerEpisode: 120 },
        enabled: false,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
      } as any,
      {
        name: 'lowSegmentMedia',
        label: 'Registry label',
        description: 'Registry description',
        targetType: 'EPISODE',
        thresholdSchema: [{ key: 'minAvgSegmentsPerEpisode', label: 'Min', type: 'number', default: 100, min: 1 }],
        run: async () => [],
      },
      {
        id: 77,
        auditName: 'lowSegmentMedia',
        category: 'ANIME',
        resultCount: 5,
        thresholdUsed: { minAvgSegmentsPerEpisode: 120 },
        createdAt: new Date('2026-02-03T00:00:00.000Z'),
      } as any,
    );

    expect(dto).toMatchObject({
      id: 12,
      name: 'lowSegmentMedia',
      label: 'Registry label',
      description: 'Registry description',
      targetType: 'EPISODE',
      threshold: { minAvgSegmentsPerEpisode: 120 },
      enabled: false,
      thresholdSchema: [{ key: 'minAvgSegmentsPerEpisode' }],
      latestRun: {
        id: 77,
        resultCount: 5,
        createdAt: '2026-02-03T00:00:00.000Z',
      },
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('maps admin media audit list with configured and unconfigured audits', () => {
    const configuredAudit = {
      id: 5,
      name: 'configuredAudit',
      label: 'Configured DB label',
      description: 'Configured DB description',
      targetType: MediaAuditTargetType.MEDIA,
      threshold: { minRatio: 0.8 },
      enabled: true,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: null,
    } as any;

    const list = toAdminMediaAuditListDTO(
      [
        {
          name: 'configuredAudit',
          label: 'Configured registry label',
          description: 'Configured registry description',
          targetType: 'MEDIA',
          thresholdSchema: [{ key: 'minRatio', label: 'Min ratio', type: 'number', default: 0.5 }],
          run: async () => [],
        },
        {
          name: 'missingAudit',
          label: 'Missing audit label',
          description: 'Missing audit description',
          targetType: 'EPISODE',
          thresholdSchema: [{ key: 'minCount', label: 'Min count', type: 'number', default: 2 }],
          run: async () => [],
        },
      ],
      new Map([['configuredAudit', configuredAudit]]),
      new Map([
        [
          'missingAudit',
          {
            id: 11,
            auditName: 'missingAudit',
            category: null,
            resultCount: 1,
            thresholdUsed: { minCount: 2 },
            createdAt: new Date('2026-02-04T00:00:00.000Z'),
          } as any,
        ],
      ]),
    );

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: 5,
      name: 'configuredAudit',
      label: 'Configured registry label',
      threshold: { minRatio: 0.8 },
      latestRun: null,
    });
    expect(list[1]).toMatchObject({
      id: 0,
      name: 'missingAudit',
      targetType: 'EPISODE',
      threshold: { minCount: 2 },
      latestRun: { id: 11, resultCount: 1, createdAt: '2026-02-04T00:00:00.000Z' },
      createdAt: null,
      updatedAt: null,
    });
  });

  it('maps media audit runs', () => {
    const run = {
      id: 21,
      auditName: 'lowSegmentMedia',
      category: null,
      resultCount: 9,
      thresholdUsed: { minAvgSegmentsPerEpisode: 80 },
      createdAt: new Date('2026-02-05T00:00:00.000Z'),
    } as any;

    expect(toMediaAuditRunDTO(run)).toEqual({
      id: 21,
      auditName: 'lowSegmentMedia',
      category: null,
      resultCount: 9,
      thresholdUsed: { minAvgSegmentsPerEpisode: 80 },
      createdAt: '2026-02-05T00:00:00.000Z',
    });

    expect(toMediaAuditRunsDTO([run])).toEqual([
      {
        id: 21,
        auditName: 'lowSegmentMedia',
        category: null,
        resultCount: 9,
        thresholdUsed: { minAvgSegmentsPerEpisode: 80 },
        createdAt: '2026-02-05T00:00:00.000Z',
      },
    ]);
  });

  it('maps run-audit response and normalizes missing category to null', () => {
    const dto = toRunAuditResponseDTO({
      checksRun: [{ auditName: 'lowSegmentMedia', label: 'Low Segment Media', resultCount: 4, runId: 33 }],
      totalReports: 4,
    });

    expect(dto).toEqual({
      category: null,
      checksRun: [{ auditName: 'lowSegmentMedia', label: 'Low Segment Media', resultCount: 4, runId: 33 }],
      totalReports: 4,
    });
  });
});
