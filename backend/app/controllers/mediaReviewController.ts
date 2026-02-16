import type {
  RunReviewChecks,
  GetReviewChecks,
  UpdateReviewCheck,
  GetReviewRuns,
  GetReviewRunDetails,
  GetReviewAllowlist,
  AddToReviewAllowlist,
  RemoveFromReviewAllowlist,
} from 'generated/routes/admin';
import { ReviewCheck, ReviewCheckRun, ReviewAllowlist, Report } from '@app/models';
import { NotFoundError, InvalidRequestError } from '@app/errors';
import { runAllChecks } from '@app/services/mediaReview/runner';
import { checkRegistry } from '@app/services/mediaReview/registry';
import { type FindOptionsWhere, LessThan } from 'typeorm';

export const runReviewChecks: RunReviewChecks = async ({ query }, respond) => {
  const category = query?.category as string | undefined;
  const result = await runAllChecks(category);

  return respond.with200().body({
    category: result.category ?? null,
    checksRun: result.checksRun,
    totalReports: result.totalReports,
  });
};

export const getReviewChecks: GetReviewChecks = async (_params, respond) => {
  const dbChecks = await ReviewCheck.find({ order: { id: 'ASC' } });

  const registryMap = new Map(checkRegistry.map((c) => [c.name, c]));

  const checksWithMeta = await Promise.all(
    dbChecks.map(async (dbCheck) => {
      const regCheck = registryMap.get(dbCheck.name);

      const latestRun = await ReviewCheckRun.findOne({
        where: { checkName: dbCheck.name },
        order: { createdAt: 'DESC' },
      });

      return {
        id: dbCheck.id,
        name: dbCheck.name,
        label: dbCheck.label,
        description: dbCheck.description,
        targetType: dbCheck.targetType,
        threshold: dbCheck.threshold,
        enabled: dbCheck.enabled,
        thresholdSchema: regCheck?.thresholdSchema ?? [],
        latestRun: latestRun
          ? { id: latestRun.id, resultCount: latestRun.resultCount, createdAt: latestRun.createdAt.toISOString() }
          : null,
        createdAt: dbCheck.createdAt.toISOString(),
        updatedAt: dbCheck.updatedAt?.toISOString() ?? null,
      };
    }),
  );

  return respond.with200().body(checksWithMeta);
};

export const updateReviewCheck: UpdateReviewCheck = async ({ params, body }, respond) => {
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

export const getReviewRuns: GetReviewRuns = async ({ query }, respond) => {
  const { checkName, cursor, size = 20 } = query;

  const where: FindOptionsWhere<ReviewCheckRun> = {};
  if (checkName) {
    where.checkName = checkName;
  }
  if (cursor) {
    where.id = LessThan(cursor);
  }

  const runs = await ReviewCheckRun.find({
    where,
    order: { id: 'DESC' },
    take: size + 1,
  });

  const hasMore = runs.length > size;
  const data = hasMore ? runs.slice(0, size) : runs;
  const nextCursor = hasMore ? data[data.length - 1]!.id : null;

  return respond.with200().body({
    data: data.map((run) => ({
      id: run.id,
      checkName: run.checkName,
      category: run.category ?? null,
      resultCount: run.resultCount,
      thresholdUsed: run.thresholdUsed,
      createdAt: run.createdAt.toISOString(),
    })),
    hasMore,
    cursor: nextCursor,
  });
};

export const getReviewRunDetails: GetReviewRunDetails = async ({ params }, respond) => {
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
    reports: reports.map((r) => ({
      id: r.id,
      source: r.source,
      targetType: r.targetType,
      targetMediaId: r.targetMediaId,
      targetEpisodeNumber: r.targetEpisodeNumber ?? null,
      targetSegmentUuid: r.targetSegmentUuid ?? null,
      reviewCheckRunId: r.reviewCheckRunId ?? null,
      reason: r.reason,
      description: r.description ?? null,
      data: r.data ?? null,
      status: r.status,
      adminNotes: r.adminNotes ?? null,
      userId: r.userId ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt?.toISOString() ?? null,
    })),
  });
};

export const getReviewAllowlist: GetReviewAllowlist = async ({ query }, respond) => {
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

export const addToReviewAllowlist: AddToReviewAllowlist = async ({ body }, respond) => {
  const { checkName, mediaId, episodeNumber, reason } = body;

  const existing = await ReviewAllowlist.findOne({
    where: { checkName, mediaId, episodeNumber: episodeNumber ?? undefined },
  });
  if (existing) {
    throw new InvalidRequestError('This item is already allowlisted');
  }

  const entry = ReviewAllowlist.create({
    checkName,
    mediaId,
    episodeNumber: episodeNumber ?? null,
    reason: reason ?? null,
  });
  await entry.save();

  return respond.with201().body({
    id: entry.id,
    checkName: entry.checkName,
    mediaId: entry.mediaId,
    episodeNumber: entry.episodeNumber ?? null,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt.toISOString(),
  });
};

export const removeFromReviewAllowlist: RemoveFromReviewAllowlist = async ({ params }, respond) => {
  const { id } = params;

  const entry = await ReviewAllowlist.findOne({ where: { id } });
  if (!entry) {
    throw new NotFoundError(`Allowlist entry with ID ${id} not found`);
  }

  await entry.remove();

  return respond.with204().body(undefined);
};
