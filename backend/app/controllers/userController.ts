import type {
  GetMe,
  ListExcludedMedia,
  AddExcludedMedia,
  RemoveExcludedMedia,
  ListFavoriteMedia,
  AddFavoriteMedia,
  RemoveFavoriteMedia,
} from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { AccountQuotaUsage, Media } from '@app/models';
import { NotFoundError } from '@app/errors';
import { toMediaSummaryDTO } from './mappers/sharedMapper';
import { toUserMeDTO } from './mappers/userMapper';
import { mutateUserPreferences, assertFavoriteMediaWithinCap } from './preferencesController';

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

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const hiddenMedia = current.hiddenMedia ?? [];
    if (hiddenMedia.some((item) => item.mediaPublicId === media.publicId)) {
      return current;
    }

    return {
      ...current,
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
  });

  return respond.with204();
};

export const removeExcludedMedia: RemoveExcludedMedia = async ({ params }, respond, req) => {
  const user = assertUser(req);

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const hiddenMedia = current.hiddenMedia ?? [];
    const nextHiddenMedia = hiddenMedia.filter((item) => item.mediaPublicId !== params.mediaPublicId);

    if (nextHiddenMedia.length === hiddenMedia.length) {
      throw new NotFoundError('Excluded media not found.');
    }

    return { ...current, hiddenMedia: nextHiddenMedia };
  });

  return respond.with204();
};

export const listFavoriteMedia: ListFavoriteMedia = async (_params, respond, req) => {
  const user = assertUser(req);
  // Newest first: the settings list reads as "what I starred lately", while the
  // search filter sorts its own copy alphabetically. Both orders come from the
  // same stored list, which is why `favoritedAt` is stored at all.
  const favoriteMedia = [...(user.preferences?.favoriteMedia ?? [])].sort((a, b) =>
    (b.favoritedAt ?? '').localeCompare(a.favoritedAt ?? ''),
  );
  const publicIds = favoriteMedia.map((item) => item.mediaPublicId).filter(Boolean);

  if (publicIds.length === 0) {
    return respond.with200().body({ favoriteMedia: [] });
  }

  const media = await Media.find({
    where: publicIds.map((mediaPublicId) => ({ publicId: mediaPublicId })),
    relations: Media.buildRelations({ includeEpisodes: false, includeExternalIds: false }),
  });
  const mediaByPublicId = new Map(media.map((item) => [item.publicId, item]));

  return respond.with200().body({
    favoriteMedia: publicIds
      .map((mediaPublicId) => mediaByPublicId.get(mediaPublicId))
      .filter((item): item is Media => item !== undefined)
      .map(toMediaSummaryDTO),
  });
};

export const addFavoriteMedia: AddFavoriteMedia = async ({ body }, respond, req) => {
  const user = assertUser(req);
  const media = await Media.findOne({ where: { publicId: body.mediaPublicId } });
  if (!media) {
    throw new NotFoundError('Media not found.');
  }

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const favoriteMedia = current.favoriteMedia ?? [];
    if (favoriteMedia.some((item) => item.mediaPublicId === media.publicId)) {
      return current;
    }

    const next = {
      ...current,
      favoriteMedia: [
        ...favoriteMedia,
        {
          mediaPublicId: media.publicId,
          nameEn: media.nameEn,
          nameJa: media.nameJa,
          nameRomaji: media.nameRomaji,
          // Server-set: a client clock decides nothing about stored order.
          favoritedAt: new Date().toISOString(),
        },
      ],
    };

    // Thrown inside the mutate callback so the transaction rolls back rather
    // than writing a list one entry past the cap.
    assertFavoriteMediaWithinCap(next);
    return next;
  });

  return respond.with204();
};

export const removeFavoriteMedia: RemoveFavoriteMedia = async ({ params }, respond, req) => {
  const user = assertUser(req);

  user.preferences = await mutateUserPreferences(user.id, (current) => {
    const favoriteMedia = current.favoriteMedia ?? [];
    const nextFavoriteMedia = favoriteMedia.filter((item) => item.mediaPublicId !== params.mediaPublicId);

    if (nextFavoriteMedia.length === favoriteMedia.length) {
      throw new NotFoundError('Favorite media not found.');
    }

    return { ...current, favoriteMedia: nextFavoriteMedia };
  });

  return respond.with204();
};
