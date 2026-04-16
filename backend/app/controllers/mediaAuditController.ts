import type {
  RunAdminMediaAudit,
  ListAdminMediaAudits,
  UpdateAdminMediaAudit,
  ListAdminMediaAuditRuns,
  GetAdminMediaAuditRun,
} from 'generated/routes/admin';
import { MediaAudit, MediaAuditRun, Report } from '@app/models';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { runAllAudits } from '@app/models/mediaAudit/runner';
import { auditRegistry } from '@app/models/mediaAudit/checks';
import type { MediaAuditCheck, ThresholdField } from '@app/models/mediaAudit/checks';
import { toReportDTO, resolveReportPublicIds } from '@app/controllers/mappers/report.mapper';
import {
  toAdminMediaAuditListDTO,
  toMediaAuditDTO,
  toMediaAuditRunDTO,
  toMediaAuditRunsDTO,
  toRunAuditResponseDTO,
} from '@app/controllers/mappers/mediaAudit.mapper';

export const listAdminMediaAudits: ListAdminMediaAudits = async (_params, respond) => {
  const [dbAudits, latestRunsByAuditName] = await Promise.all([
    MediaAudit.find({ order: { id: 'ASC' } }),
    getLatestRunsByAuditName(),
  ]);
  const dbAuditMap = new Map(dbAudits.map((c) => [c.name, c]));

  return respond.with200().body(toAdminMediaAuditListDTO(auditRegistry, dbAuditMap, latestRunsByAuditName));
};

export const updateAdminMediaAudit: UpdateAdminMediaAudit = async ({ params, body }, respond) => {
  const audit = await getMediaAuditOrFail(params.name);
  mergeAuditUpdate(audit, body);

  await audit.save();

  return respond.with200().body(toMediaAuditDTO(audit, getRegistryAudit(audit.name)));
};

export const runAdminMediaAudit: RunAdminMediaAudit = async ({ params, query }, respond) => {
  const { name } = params;
  const category = query?.category;
  const auditName = name === 'all' ? undefined : name;
  const result = await runAllAudits(category, auditName);

  return respond.with200().body(toRunAuditResponseDTO(result));
};

export const listAdminMediaAuditRuns: ListAdminMediaAuditRuns = async ({ query }, respond) => {
  const { items: runs, pagination } = await MediaAuditRun.paginateWithKeyset({
    take: query.take ?? 20,
    cursor: query.cursor,
    query: () => {
      const qb = MediaAuditRun.createQueryBuilder('run');

      if (query.auditName) {
        qb.andWhere('run.audit_name = :auditName', { auditName: query.auditName });
      }

      return qb;
    },
  });

  return respond.with200().body({
    runs: toMediaAuditRunsDTO(runs),
    pagination,
  });
};

export const getAdminMediaAuditRun: GetAdminMediaAuditRun = async ({ params }, respond) => {
  const run = await getMediaAuditRunOrFail(params.id);

  const reports = await Report.find({
    where: { auditRunId: run.id },
    order: { id: 'ASC' },
  });

  const publicIdMaps = await resolveReportPublicIds(reports);

  return respond.with200().body({
    run: toMediaAuditRunDTO(run),
    reports: reports.map((report) =>
      toReportDTO(report, {
        mediaPublicId: publicIdMaps.media.get(report.targetMediaId)?.publicId ?? '',
        segmentPublicId: report.targetSegmentId ? (publicIdMaps.segments.get(report.targetSegmentId) ?? null) : null,
      }),
    ),
  });
};

function getRegistryAudit(name: string) {
  return auditRegistry.find((audit) => audit.name === name);
}

async function getMediaAuditOrFail(name: string): Promise<MediaAudit> {
  const audit = await MediaAudit.findOne({ where: { name } });

  if (!audit) {
    throw new NotFoundError(`Audit with name "${name}" not found`);
  }

  return audit;
}

async function getMediaAuditRunOrFail(id: number): Promise<MediaAuditRun> {
  const run = await MediaAuditRun.findOne({ where: { id } });

  if (!run) {
    throw new NotFoundError(`Run with ID ${id} not found`);
  }

  return run;
}

async function getLatestRunsByAuditName(): Promise<Map<string, MediaAuditRun>> {
  const runs = await MediaAuditRun.createQueryBuilder('run')
    .distinctOn(['run.auditName'])
    .orderBy('run.auditName', 'ASC')
    .addOrderBy('run.createdAt', 'DESC')
    .addOrderBy('run.id', 'DESC')
    .getMany();

  return new Map(runs.map((run) => [run.auditName, run]));
}

function mergeAuditUpdate(audit: MediaAudit, body: Parameters<UpdateAdminMediaAudit>[0]['body']): void {
  if (body.threshold !== undefined) {
    const registryAudit = getRegistryAudit(audit.name);
    if (!registryAudit) {
      throw new InvalidRequestError(`Audit "${audit.name}" does not have a registered threshold schema`);
    }

    const thresholdPatch = validateThresholdPatch(registryAudit, body.threshold as Record<string, unknown>);
    audit.threshold = { ...audit.threshold, ...thresholdPatch };
  }

  if (body.enabled !== undefined) {
    audit.enabled = body.enabled;
  }
}

function validateThresholdPatch(
  audit: MediaAuditCheck,
  patch: Record<string, unknown>,
): Record<string, number | boolean> {
  const fieldsByKey = new Map(audit.thresholdSchema.map((field) => [field.key, field]));
  const validated: Record<string, number | boolean> = {};

  for (const [key, rawValue] of Object.entries(patch)) {
    const field = fieldsByKey.get(key);
    if (!field) {
      throw new InvalidRequestError(`Unknown threshold key "${key}" for audit "${audit.name}"`);
    }

    validated[key] = validateThresholdValue(field, rawValue);
  }

  return validated;
}

function validateThresholdValue(field: ThresholdField, value: unknown): number | boolean {
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new InvalidRequestError(`Threshold "${field.key}" must be a boolean`);
    }
    return value;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidRequestError(`Threshold "${field.key}" must be a finite number`);
  }

  if (field.min !== undefined && value < field.min) {
    throw new InvalidRequestError(`Threshold "${field.key}" must be >= ${field.min}`);
  }

  if (field.max !== undefined && value > field.max) {
    throw new InvalidRequestError(`Threshold "${field.key}" must be <= ${field.max}`);
  }

  return value;
}
