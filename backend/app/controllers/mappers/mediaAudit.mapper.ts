import type { t_MediaAudit, t_MediaAuditRun } from 'generated/models';
import type { MediaAudit, MediaAuditRun } from '@app/models';
import type { MediaAuditCheck, ThresholdField } from '@app/models/mediaAudit/checks';

type AuditRunSummary = {
  auditName: string;
  label: string;
  resultCount: number;
  runId: number;
};

type RunAuditResult = {
  category?: string;
  checksRun: AuditRunSummary[];
  totalReports: number;
};

export function toThresholdDefaults(schema: ThresholdField[]): Record<string, number | boolean> {
  return schema.reduce<Record<string, number | boolean>>((defaults, field) => {
    defaults[field.key] = field.default;
    return defaults;
  }, {});
}

function toMediaAuditLatestRunDTO(run: MediaAuditRun): NonNullable<t_MediaAudit['latestRun']> {
  return {
    id: run.id,
    resultCount: run.resultCount,
    createdAt: run.createdAt.toISOString(),
  };
}

export function toMediaAuditRunDTO(run: MediaAuditRun): t_MediaAuditRun {
  return {
    id: run.id,
    auditName: run.auditName,
    category: run.category ?? null,
    resultCount: run.resultCount,
    thresholdUsed: run.thresholdUsed,
    createdAt: run.createdAt.toISOString(),
  };
}

export function toMediaAuditRunsDTO(runs: MediaAuditRun[]): t_MediaAuditRun[] {
  return runs.map(toMediaAuditRunDTO);
}

export function toMediaAuditDTO(
  audit: MediaAudit,
  registryAudit?: MediaAuditCheck,
  latestRun?: MediaAuditRun | null,
): t_MediaAudit {
  return {
    id: audit.id,
    name: audit.name,
    label: registryAudit?.label ?? audit.label,
    description: registryAudit?.description ?? audit.description,
    targetType: (registryAudit?.targetType ?? audit.targetType) as t_MediaAudit['targetType'],
    threshold: audit.threshold,
    enabled: audit.enabled,
    thresholdSchema: registryAudit?.thresholdSchema ?? [],
    latestRun: latestRun ? toMediaAuditLatestRunDTO(latestRun) : null,
    createdAt: audit.createdAt.toISOString(),
    updatedAt: audit.updatedAt?.toISOString() ?? null,
  };
}

export function toAdminMediaAuditListDTO(
  registry: MediaAuditCheck[],
  dbAuditByName: ReadonlyMap<string, MediaAudit>,
  latestRunByAuditName: ReadonlyMap<string, MediaAuditRun>,
): t_MediaAudit[] {
  return registry.map((registryAudit) => {
    const dbAudit = dbAuditByName.get(registryAudit.name);
    const latestRun = latestRunByAuditName.get(registryAudit.name) ?? null;

    if (dbAudit) {
      return toMediaAuditDTO(dbAudit, registryAudit, latestRun);
    }

    return {
      id: 0,
      name: registryAudit.name,
      label: registryAudit.label,
      description: registryAudit.description,
      targetType: registryAudit.targetType as t_MediaAudit['targetType'],
      threshold: toThresholdDefaults(registryAudit.thresholdSchema),
      enabled: true,
      thresholdSchema: registryAudit.thresholdSchema,
      latestRun: latestRun ? toMediaAuditLatestRunDTO(latestRun) : null,
      createdAt: null,
      updatedAt: null,
    };
  });
}

export function toRunAuditResponseDTO(result: RunAuditResult) {
  return {
    category: result.category ?? null,
    checksRun: result.checksRun.map((check) => ({
      auditName: check.auditName,
      label: check.label,
      resultCount: check.resultCount,
      runId: check.runId,
    })),
    totalReports: result.totalReports,
  };
}
