import type {
  RunAdminMediaAudit,
  ListAdminMediaAudits,
  UpdateAdminMediaAudit,
  ListAdminMediaAuditRuns,
  GetAdminMediaAuditRun,
} from 'generated/routes/admin';
import { MediaAudit, MediaAuditRun, Report } from '@app/models';
import { NotFoundError } from '@app/errors';
import { runAllAudits } from '@app/models/mediaAudit/runner';
import { auditRegistry } from '@app/models/mediaAudit/checks';
import { toReportDTO } from '@app/controllers/mappers/report.mapper';
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

  return respond.with200().body({
    run: toMediaAuditRunDTO(run),
    reports: reports.map(toReportDTO),
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
  const runs = await MediaAuditRun.find({ order: { createdAt: 'DESC', id: 'DESC' } });
  const latestRuns = new Map<string, MediaAuditRun>();

  for (const run of runs) {
    if (!latestRuns.has(run.auditName)) {
      latestRuns.set(run.auditName, run);
    }
  }

  return latestRuns;
}

function mergeAuditUpdate(audit: MediaAudit, body: Parameters<UpdateAdminMediaAudit>[0]['body']): void {
  if (body.threshold !== undefined) {
    audit.threshold = { ...audit.threshold, ...(body.threshold as Record<string, number | boolean>) };
  }

  if (body.enabled !== undefined) {
    audit.enabled = body.enabled;
  }
}
