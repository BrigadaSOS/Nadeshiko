import type { GetMe, ListExcludedMedia, AddExcludedMedia, RemoveExcludedMedia } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { AccountQuotaUsage, Media, User } from '@app/models';
import { NotFoundError } from '@app/errors';
import { toMediaSummaryDTO } from './mappers/sharedMapper';
import { toUserMeDTO } from './mappers/userMapper';

export const getMe: GetMe = async (_params, respond, req) => {
  const user = assertUser(req);
  const quota = await AccountQuotaUsage.getForUser(user.id, user.monthlyQuotaLimit);
  const window = AccountQuotaUsage.getQuotaWindow(quota.periodYyyymm);

  return respond.with200().body(toUserMeDTO(user, quota, window));
};


export const listExcludedMedia: ListExcludedMedia = async (_params, respond, req) => {
  const user = assertUser(req);
  const hiddenMedia = user.preferences?.hiddenMedia ?? [];
  const publicIds = hiddenMedia.map((item) => item.mediaPublicId).filter(Boolean);

  if (publicIds.length === 0) {
    return respond.with200().body({ excludedMedia: [] });
  }

  const media = await Media.find({
    where: publicIds.map((mediaPublicId) => ({ publicId: mediaPublicId })),
    relations: Media.buildRelations({ includeEpisodes: false, includeExternalIds: false }),
  });
  const mediaByPublicId = new Map(media.map((item) => [item.publicId, item]));

  return respond.with200().body({
    excludedMedia: publicIds
      .map((mediaPublicId) => mediaByPublicId.get(mediaPublicId))
      .filter((item): item is Media => item !== undefined)
      .map(toMediaSummaryDTO),
  });
};


export const addExcludedMedia: AddExcludedMedia = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const media = await Media.findOne({ where: { publicId: body.mediaPublicId } });
  if (!media) {
    throw new NotFoundError('Media not found.');
  }

  const hiddenMedia = user.preferences?.hiddenMedia ?? [];
  if (hiddenMedia.some((item) => item.mediaPublicId === media.publicId)) {
    return respond.with204();
  }

  const updatedPreferences = {
    ...user.preferences,
    hiddenMedia: [
      ...hiddenMedia,
      {
        mediaPublicId: media.publicId,
        nameEn: media.nameEn,
        nameJa: media.nameJa,
        nameRomaji: media.nameRomaji,
      },
    ],
  };

  await User.update({ id: user.id }, { preferences: updatedPreferences });
  user.preferences = updatedPreferences;

  return respond.with204();
};


export const removeExcludedMedia: RemoveExcludedMedia = async ({ params }, respond, req) => {
  const user = assertUser(req);
  const hiddenMedia = user.preferences?.hiddenMedia ?? [];
  const nextHiddenMedia = hiddenMedia.filter((item) => item.mediaPublicId !== params.mediaPublicId);

  if (nextHiddenMedia.length === hiddenMedia.length) {
    throw new NotFoundError('Excluded media not found.');
  }

  const updatedPreferences = {
    ...user.preferences,
    hiddenMedia: nextHiddenMedia,
  };

  await User.update({ id: user.id }, { preferences: updatedPreferences });
  user.preferences = updatedPreferences;

  return respond.with204();
};
