import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import {
  MediaAudit,
  MediaAuditRun,
  MediaAuditTargetType,
  Report,
  ReportReason,
  ReportSource,
  ReportStatus,
  ReportTargetType,
} from '@app/models';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';
import { auditRegistry } from '@app/models/mediaAudit/checks';

const mockRunAllAudits = vi.fn();

vi.mock('@app/models/mediaAudit/runner', () => ({
  runAllAudits: (...args: unknown[]) => mockRunAllAudits(...args),
}));

setupTestSuite();

let app: Application;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.auth = {
    type: AuthType.API_KEY,
    apiKey: {
      kind: ApiKeyKind.SERVICE,
      permissions: Object.values(ApiPermission),
    },
  };
  next();
}

function toThresholdDefaults(schema: Array<{ key: string; default: number | boolean }>) {
  return schema.reduce<Record<string, number | boolean>>((defaults, field) => {
    defaults[field.key] = field.default;
    return defaults;
  }, {});
}

beforeAll(() => {
  app = buildApplication({
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  mockRunAllAudits.mockReset();
});

describe('GET /v1/admin/media/audits', () => {
  it('returns registry audits with DB overrides and latest run metadata', async () => {
    const configuredAudit = auditRegistry.find((a) => a.thresholdSchema.length > 0);
    if (!configuredAudit) throw new Error('Expected at least one audit with thresholds');
    const unconfiguredAudit = auditRegistry.find((a) => a.name !== configuredAudit.name);
    if (!unconfiguredAudit) throw new Error('Expected at least two distinct audits');

    const configuredDefaults = toThresholdDefaults(configuredAudit.thresholdSchema);
    const configuredKey = configuredAudit.thresholdSchema[0]?.key;
    if (!configuredKey) {
      throw new Error('Expected configured audit threshold schema to have at least one field');
    }
    const configuredValue =
      typeof configuredDefaults[configuredKey] === 'boolean' ? !(configuredDefaults[configuredKey] as boolean) : 777;
    const configuredThreshold = {
      ...configuredDefaults,
      [configuredKey]: configuredValue,
    };

    await MediaAudit.upsert(
      {
        name: configuredAudit.name,
        label: `DB ${configuredAudit.label}`,
        description: `DB ${configuredAudit.description}`,
        targetType: configuredAudit.targetType as MediaAuditTargetType,
        threshold: configuredThreshold,
        enabled: false,
      },
      { conflictPaths: ['name'] },
    );
    await MediaAudit.delete({ name: unconfiguredAudit.name });

    await MediaAuditRun.delete({ auditName: configuredAudit.name });
    await MediaAuditRun.delete({ auditName: unconfiguredAudit.name });

    await MediaAuditRun.save({
      auditName: configuredAudit.name,
      category: 'ANIME',
      resultCount: 2,
      thresholdUsed: configuredThreshold,
    });
    const latestRun = (await MediaAuditRun.save({
      auditName: configuredAudit.name,
      category: 'ANIME',
      resultCount: 5,
      thresholdUsed: configuredThreshold,
    })) as MediaAuditRun;

    const savedAudit = await MediaAudit.findOneByOrFail({ name: configuredAudit.name });

    const res = await request(app).get('/v1/admin/media/audits');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(auditRegistry.length);

    const configured = res.body.find((row: any) => row.name === configuredAudit.name);
    expect(configured).toMatchObject({
      id: savedAudit.id,
      name: configuredAudit.name,
      label: configuredAudit.label,
      description: configuredAudit.description,
      targetType: configuredAudit.targetType,
      threshold: configuredThreshold,
      enabled: false,
      latestRun: {
        id: latestRun.id,
        resultCount: 5,
      },
    });

    const unconfigured = res.body.find((row: any) => row.name === unconfiguredAudit.name);
    expect(unconfigured).toMatchObject({
      id: 0,
      name: unconfiguredAudit.name,
      label: unconfiguredAudit.label,
      description: unconfiguredAudit.description,
      targetType: unconfiguredAudit.targetType,
      threshold: toThresholdDefaults(unconfiguredAudit.thresholdSchema),
      enabled: true,
      latestRun: null,
      createdAt: null,
      updatedAt: null,
    });
  });
});

describe('PATCH /v1/admin/media/audits/:name', () => {
  it('merges threshold patch and updates enabled flag', async () => {
    const registryAudit = auditRegistry.find((a) => a.thresholdSchema.length > 0) as (typeof auditRegistry)[number];
    const defaults = toThresholdDefaults(registryAudit.thresholdSchema);
    const key = registryAudit.thresholdSchema[0].key;

    await MediaAudit.upsert(
      {
        name: registryAudit.name,
        label: `DB ${registryAudit.label}`,
        description: `DB ${registryAudit.description}`,
        targetType: registryAudit.targetType as MediaAuditTargetType,
        threshold: defaults,
        enabled: true,
      },
      { conflictPaths: ['name'] },
    );

    const updatedValue = typeof defaults[key] === 'boolean' ? !(defaults[key] as boolean) : Number(defaults[key]) + 5;

    const res = await request(app)
      .patch(`/v1/admin/media/audits/${registryAudit.name}`)
      .send({
        threshold: { [key]: updatedValue },
        enabled: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: registryAudit.name,
      enabled: false,
      thresholdSchema: registryAudit.thresholdSchema,
    });
    expect(res.body.threshold[key]).toBe(updatedValue);

    const saved = await MediaAudit.findOneByOrFail({ name: registryAudit.name });
    expect(saved.enabled).toBe(false);
    expect(saved.threshold[key]).toBe(updatedValue);
  });

  it('returns 404 when audit does not exist', async () => {
    const res = await request(app).patch('/v1/admin/media/audits/missing-audit').send({
      enabled: false,
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 'NOT_FOUND',
      detail: 'Audit with name "missing-audit" not found',
    });
  });

  it('returns 400 when threshold patch includes unknown keys', async () => {
    const registryAudit = auditRegistry[0];
    await MediaAudit.upsert(
      {
        name: registryAudit.name,
        label: registryAudit.label,
        description: registryAudit.description,
        targetType: registryAudit.targetType as MediaAuditTargetType,
        threshold: toThresholdDefaults(registryAudit.thresholdSchema),
        enabled: true,
      },
      { conflictPaths: ['name'] },
    );

    const res = await request(app)
      .patch(`/v1/admin/media/audits/${registryAudit.name}`)
      .send({
        threshold: { doesNotExist: 1 },
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_REQUEST',
      detail: `Unknown threshold key "doesNotExist" for audit "${registryAudit.name}"`,
    });
  });

  it('returns 400 when threshold patch value type is invalid', async () => {
    const registryAudit = auditRegistry.find((audit) => audit.thresholdSchema.some((field) => field.type === 'number'));
    if (!registryAudit) {
      throw new Error('Expected at least one audit with a numeric threshold field');
    }

    const numberField = registryAudit.thresholdSchema.find((field) => field.type === 'number');
    if (!numberField) {
      throw new Error('Expected at least one numeric threshold field');
    }

    await MediaAudit.upsert(
      {
        name: registryAudit.name,
        label: registryAudit.label,
        description: registryAudit.description,
        targetType: registryAudit.targetType as MediaAuditTargetType,
        threshold: toThresholdDefaults(registryAudit.thresholdSchema),
        enabled: true,
      },
      { conflictPaths: ['name'] },
    );

    const res = await request(app)
      .patch(`/v1/admin/media/audits/${registryAudit.name}`)
      .send({
        threshold: { [numberField.key]: true },
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_REQUEST',
      detail: `Threshold "${numberField.key}" must be a finite number`,
    });
  });
});

describe('POST /v1/admin/media/audits/:name/run', () => {
  it('runs a specific audit and returns summary payload', async () => {
    mockRunAllAudits.mockResolvedValue({
      category: 'ANIME',
      checksRun: [{ auditName: 'lowSegmentMedia', label: 'Low Segment Media', resultCount: 3, runId: 10 }],
      totalReports: 3,
    });

    const res = await request(app).post('/v1/admin/media/audits/lowSegmentMedia/run?category=ANIME');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      category: 'ANIME',
      checksRun: [{ auditName: 'lowSegmentMedia', label: 'Low Segment Media', resultCount: 3, runId: 10 }],
      totalReports: 3,
    });
    expect(mockRunAllAudits).toHaveBeenCalledWith('ANIME', 'lowSegmentMedia');
  });

  it('maps "all" to undefined audit name and null category when missing', async () => {
    mockRunAllAudits.mockResolvedValue({
      checksRun: [],
      totalReports: 0,
    });

    const res = await request(app).post('/v1/admin/media/audits/all/run');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      category: null,
      checksRun: [],
      totalReports: 0,
    });
    expect(mockRunAllAudits).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe('GET /v1/admin/media/audits/runs', () => {
  it('lists runs with audit filter and keyset pagination', async () => {
    const auditName = `audit-filter-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const otherAuditName = `audit-other-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const firstRun = (await MediaAuditRun.save({
      auditName,
      category: null,
      resultCount: 1,
      thresholdUsed: { ratio: 0.1 },
    })) as MediaAuditRun;
    const secondRun = (await MediaAuditRun.save({
      auditName,
      category: 'ANIME',
      resultCount: 2,
      thresholdUsed: { ratio: 0.2 },
    })) as MediaAuditRun;
    await MediaAuditRun.save({
      auditName: otherAuditName,
      category: null,
      resultCount: 99,
      thresholdUsed: { ratio: 0.9 },
    });

    const page1 = await request(app).get(
      `/v1/admin/media/audits/runs?auditName=${encodeURIComponent(auditName)}&take=1`,
    );

    expect(page1.status).toBe(200);
    expect(page1.body.runs).toHaveLength(1);
    expect(page1.body.runs[0]).toMatchObject({
      id: secondRun.id,
      auditName,
      category: 'ANIME',
      resultCount: 2,
    });
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.pagination.cursor).toEqual(expect.any(String));

    const page2 = await request(app).get(
      `/v1/admin/media/audits/runs?auditName=${encodeURIComponent(auditName)}&take=1&cursor=${page1.body.pagination.cursor}`,
    );

    expect(page2.status).toBe(200);
    expect(page2.body.runs).toHaveLength(1);
    expect(page2.body.runs[0]).toMatchObject({
      id: firstRun.id,
      auditName,
      category: null,
      resultCount: 1,
    });
    expect(page2.body.pagination).toEqual({
      hasMore: false,
      cursor: null,
    });
  });
});

describe('GET /v1/admin/media/audits/runs/:id', () => {
  it('returns run details with reports', async () => {
    const run = (await MediaAuditRun.save({
      auditName: 'dbEsSyncIssues',
      category: 'ANIME',
      resultCount: 2,
      thresholdUsed: { maxMismatchRatio: 0.2 },
    })) as MediaAuditRun;

    const firstReport = (await Report.save({
      source: ReportSource.AUTO,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: 1001,
      targetEpisodeNumber: null,
      reason: ReportReason.DB_ES_SYNC_ISSUES,
      description: 'mismatch found',
      status: ReportStatus.OPEN,
      auditRunId: run.id,
      userId: null,
    })) as Report;
    const secondReport = (await Report.save({
      source: ReportSource.AUTO,
      targetType: ReportTargetType.EPISODE,
      targetMediaId: 1001,
      targetEpisodeNumber: 3,
      reason: ReportReason.EMPTY_EPISODES,
      description: 'episode has no segments',
      status: ReportStatus.PROCESSING,
      auditRunId: run.id,
      userId: null,
    })) as Report;

    const res = await request(app).get(`/v1/admin/media/audits/runs/${run.id}`);

    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({
      id: run.id,
      auditName: 'dbEsSyncIssues',
      category: 'ANIME',
      resultCount: 2,
      thresholdUsed: { maxMismatchRatio: 0.2 },
    });
    expect(res.body.reports).toHaveLength(2);
    expect(res.body.reports[0]).toMatchObject({
      id: firstReport.id,
      auditRunId: run.id,
      target: {
        type: 'MEDIA',
        mediaPublicId: '',
      },
    });
    expect(res.body.reports[1]).toMatchObject({
      id: secondReport.id,
      auditRunId: run.id,
      target: {
        type: 'EPISODE',
        mediaPublicId: '',
        episodeNumber: 3,
      },
    });
  });

  it('returns 404 when run id does not exist', async () => {
    const res = await request(app).get('/v1/admin/media/audits/runs/999999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 'NOT_FOUND',
      detail: 'Run with ID 999999 not found',
    });
  });
});
