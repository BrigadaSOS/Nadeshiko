import type {
  RunAdminReview,
  ListAdminReviewChecks,
  UpdateAdminReviewCheck,
  ListAdminReviewRuns,
  GetAdminReviewRun,
  ListAdminReviewAllowlist,
  CreateAdminReviewAllowlistEntry,
  DeleteAdminReviewAllowlistEntry,
} from 'generated/routes/admin';
import { ReviewCheck, ReviewCheckRun, ReviewAllowlist, Report } from '@app/models';
import { NotFoundError } from '@app/errors';
import { runAllChecks } from '@app/services/mediaReview/runner';
import { checkRegistry } from '@app/services/mediaReview/registry';
import { toReportDTO } from '@app/controllers/mappers/report.mapper';

export const runAdminReview: RunAdminReview = async ({ query }, respond) => {
  const category = query?.category as string | undefined;
  const checkName = query?.checkName as string | undefined;
  const result = await runAllChecks(category, checkName);

  return respond.with200().body({
    category: result.category ?? null,
    checksRun: result.checksRun,
    totalReports: result.totalReports,
  });
};

export const listAdminReviewChecks: ListAdminReviewChecks = async (_params, respond) => {
  const dbChecks = await ReviewCheck.find({ order: { id: 'ASC' } });
  const dbCheckMap = new Map(dbChecks.map((c) => [c.name, c]));

  const checksWithMeta = await Promise.all(
    checkRegistry.map(async (regCheck) => {
      const dbCheck = dbCheckMap.get(regCheck.name);

      const latestRun = await ReviewCheckRun.findOne({
        where: { checkName: regCheck.name },
        order: { createdAt: 'DESC' },
      });

      const defaults: Record<string, number | boolean> = {};
      for (const field of regCheck.thresholdSchema) {
        defaults[field.key] = field.default;
      }

      return {
        id: dbCheck?.id ?? 0,
        name: regCheck.name,
        label: regCheck.label,
        description: regCheck.description,
        targetType: dbCheck?.targetType ?? regCheck.targetType,
        threshold: dbCheck?.threshold ?? defaults,
        enabled: dbCheck?.enabled ?? true,
        thresholdSchema: regCheck.thresholdSchema,
        latestRun: latestRun
          ? { id: latestRun.id, resultCount: latestRun.resultCount, createdAt: latestRun.createdAt.toISOString() }
          : null,
        createdAt: dbCheck?.createdAt.toISOString(),
        updatedAt: dbCheck?.updatedAt?.toISOString() ?? null,
      };
    }),
  );

  return respond.with200().body(checksWithMeta);
};

export const updateAdminReviewCheck: UpdateAdminReviewCheck = async ({ params, body }, respond) => {
  const { name } = params;

  const check = await ReviewCheck.findOne({ where: { name } });
  if (!check) {
    throw new NotFoundError(`Check with name "${name}" not found`);
  }

  if (body.threshold !== undefined) {
    check.threshold = { ...check.threshold, ...(body.threshold as Record<string, number | boolean>) };
  }

  if (body.enabled !== undefined) {
    check.enabled = body.enabled;
  }

  await check.save();

  const regCheck = checkRegistry.find((c) => c.name === check.name);

  return respond.with200().body({
    id: check.id,
    name: check.name,
    label: check.label,
    description: check.description,
    targetType: check.targetType,
    threshold: check.threshold,
    enabled: check.enabled,
    thresholdSchema: regCheck?.thresholdSchema ?? [],
    createdAt: check.createdAt.toISOString(),
    updatedAt: check.updatedAt?.toISOString() ?? null,
  });
};

export const listAdminReviewRuns: ListAdminReviewRuns = async ({ query }, respond) => {
  const { items: runs, pagination } = await ReviewCheckRun.paginateWithKeyset({
    take: query.take ?? 20,
    cursor: query.cursor,
    query: () => {
      const qb = ReviewCheckRun.createQueryBuilder('run');

      if (query.checkName) {
        qb.andWhere('run.check_name = :checkName', { checkName: query.checkName });
      }

      return qb;
    },
  });

  return respond.with200().body({
    runs: runs.map((run) => ({
      id: run.id,
      checkName: run.checkName,
      category: run.category ?? null,
      resultCount: run.resultCount,
      thresholdUsed: run.thresholdUsed,
      createdAt: run.createdAt.toISOString(),
    })),
    pagination,
  });
};

export const getAdminReviewRun: GetAdminReviewRun = async ({ params }, respond) => {
  const { id } = params;

  const run = await ReviewCheckRun.findOne({ where: { id } });
  if (!run) {
    throw new NotFoundError(`Run with ID ${id} not found`);
  }

  const reports = await Report.find({
    where: { reviewCheckRunId: run.id },
    order: { id: 'ASC' },
  });

  return respond.with200().body({
    run: {
      id: run.id,
      checkName: run.checkName,
      category: run.category ?? null,
      resultCount: run.resultCount,
      thresholdUsed: run.thresholdUsed,
      createdAt: run.createdAt.toISOString(),
    },
    reports: reports.map(toReportDTO),
  });
};

export const listAdminReviewAllowlist: ListAdminReviewAllowlist = async ({ query }, respond) => {
  const where: FindOptionsWhere<ReviewAllowlist> = {};
  if (query?.checkName) {
    where.checkName = query.checkName;
  }

  const entries = await ReviewAllowlist.find({ where, order: { id: 'DESC' } });

  return respond.with200().body(
    entries.map((e) => ({
      id: e.id,
      checkName: e.checkName,
      mediaId: e.mediaId,
      episodeNumber: e.episodeNumber ?? null,
      reason: e.reason ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  );
};

export const createAdminReviewAllowlistEntry: CreateAdminReviewAllowlistEntry = async ({ body }, respond) => {
  const { checkName, mediaId, episodeNumber, reason } = body;

  const entry = await ReviewAllowlist.save({
    checkName,
    mediaId,
    episodeNumber: episodeNumber ?? null,
    reason: reason ?? null,
  });

  return respond.with201().body({
    id: entry.id,
    checkName: entry.checkName,
    mediaId: entry.mediaId,
    episodeNumber: entry.episodeNumber ?? null,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt.toISOString(),
  });
};

export const deleteAdminReviewAllowlistEntry: DeleteAdminReviewAllowlistEntry = async ({ params }, respond) => {
  const { id } = params;

  const entry = await ReviewAllowlist.findOne({ where: { id } });
  if (!entry) {
    throw new NotFoundError(`Allowlist entry with ID ${id} not found`);
  }

  await entry.remove();

  return respond.with204().body(undefined);
};
