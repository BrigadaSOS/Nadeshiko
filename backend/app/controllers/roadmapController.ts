import { In, Not } from 'typeorm';
import type { CreateRoadmapProposal, ListRoadmap } from 'generated/routes/roadmap';
import type { CreateAdminRoadmapItem, ListAdminRoadmap, UpdateAdminRoadmapItem } from 'generated/routes/admin';
import { RoadmapItem, RoadmapItemKind, RoadmapItemStatus } from '@app/models';
import { AccessDeniedError, NotFoundError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { getPatreonConnection } from '@app/services/patreon/connection';
import { getAniListMediaMetadata } from '@app/services/roadmap/anilist';
import { config } from '@config/config';

const publicStatuses = [
  RoadmapItemStatus.CONSIDERING,
  RoadmapItemStatus.PLANNED,
  RoadmapItemStatus.IN_PROGRESS,
  RoadmapItemStatus.RELEASED,
];
const PATREON_PROPOSALS_ENABLED = false;

export const listRoadmap: ListRoadmap = async (_params, respond) => {
  const items = await RoadmapItem.find({
    where: { status: In(publicStatuses) },
    order: { sortOrder: 'ASC', createdAt: 'ASC' },
  });
  return respond.with200().body({
    items: items
      .filter((item) => PATREON_PROPOSALS_ENABLED || item.title !== 'Patreon title proposals')
      .map((item) => item.toJSON()),
    patreonUrl: config.PATREON_CAMPAIGN_URL,
  });
};

function inferredTitle(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  const tail = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '').replace(/[-_]+/g, ' ');
  return tail || url.hostname.replace(/^www\./, '');
}

export const createRoadmapProposal: CreateRoadmapProposal = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const connection = await getPatreonConnection(user.id, true);
  if (!connection?.active) {
    throw new AccessDeniedError('An active Nadeshiko Patreon membership is required to propose a show.');
  }

  const duplicate = await RoadmapItem.findOneBy({
    requesterUserId: user.id,
    sourceUrl: body.sourceUrl,
    status: Not(RoadmapItemStatus.DECLINED),
  });
  if (duplicate) return respond.with201().body(duplicate.toJSON());

  const aniList = await getAniListMediaMetadata(body.sourceUrl);
  const item = RoadmapItem.create({
    kind: RoadmapItemKind.CONTENT,
    status: RoadmapItemStatus.PROPOSED,
    title: body.title?.trim() || aniList?.title || inferredTitle(body.sourceUrl),
    description: body.note?.trim() ?? '',
    sourceUrl: body.sourceUrl,
    coverUrl: aniList?.coverUrl ?? null,
    proposerName: body.proposerName?.trim() || null,
    requesterUserId: user.id,
    sortOrder: 0,
  });
  await item.save();
  return respond.with201().body(item.toJSON());
};

export const listAdminRoadmap: ListAdminRoadmap = async (_params, respond) => {
  const items = await RoadmapItem.find({ order: { status: 'ASC', sortOrder: 'ASC', createdAt: 'ASC' } });
  return respond.with200().body({ items: items.map((item) => item.toJSON(true)) });
};

export const createAdminRoadmapItem: CreateAdminRoadmapItem = async ({ body }, respond) => {
  const aniList =
    body.kind === RoadmapItemKind.CONTENT && body.sourceUrl ? await getAniListMediaMetadata(body.sourceUrl) : null;
  const item = RoadmapItem.create({
    ...body,
    kind: body.kind as RoadmapItemKind,
    status: body.status as RoadmapItemStatus,
    description: body.description ?? '',
    sourceUrl: body.sourceUrl ?? null,
    coverUrl: body.coverUrl ?? aniList?.coverUrl ?? null,
    proposerName: body.proposerName ?? null,
    targetDate: body.targetDate ?? null,
    introducedInVersion: body.introducedInVersion ?? null,
    sortOrder: body.sortOrder ?? 0,
  });
  await item.save();
  return respond.with201().body(item.toJSON(true));
};

export const updateAdminRoadmapItem: UpdateAdminRoadmapItem = async ({ params, body }, respond) => {
  const item = await RoadmapItem.findOneBy({ publicId: params.itemId });
  if (!item) throw new NotFoundError('Roadmap item not found');
  Object.assign(item, {
    ...(body.kind !== undefined ? { kind: body.kind as RoadmapItemKind } : {}),
    ...(body.status !== undefined ? { status: body.status as RoadmapItemStatus } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
    ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
    ...(body.proposerName !== undefined ? { proposerName: body.proposerName } : {}),
    ...(body.targetDate !== undefined ? { targetDate: body.targetDate } : {}),
    ...(body.introducedInVersion !== undefined ? { introducedInVersion: body.introducedInVersion } : {}),
    ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
  });
  await item.save();
  return respond.with200().body(item.toJSON(true));
};
