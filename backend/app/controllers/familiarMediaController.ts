import type { ListFamiliarMedia } from 'generated/routes/activity';
import type { ClearFamiliarMedia } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { Media, UserMediaAffinity } from '@app/models';
import { toMediaSummaryDTO } from './mappers/sharedMapper';

export const listFamiliarMedia: ListFamiliarMedia = async (_params, respond, req) => {
  const user = assertUser(req);

  // The preference is honoured on read as well as on write. Rows can predate a
  // reader turning the tally off, and until they are cleared they must not keep
  // steering the filter.
  if (user.preferences?.familiarMedia?.enabled === false) {
    return respond.with200().body({ familiarMedia: [] });
  }

  const entries = await UserMediaAffinity.getFamiliarForUser(user.id);
  if (entries.length === 0) {
    return respond.with200().body({ familiarMedia: [] });
  }

  const media = await Media.find({
    where: entries.map((entry) => ({ publicId: entry.mediaPublicId })),
    relations: Media.buildRelations({ includeEpisodes: false, includeExternalIds: false }),
  });
  const mediaByPublicId = new Map(media.map((item) => [item.publicId, item]));

  return respond.with200().body({
    // Ranking order is preserved, and titles whose media has since been deleted
    // are dropped rather than rendered as a gap.
    familiarMedia: entries.flatMap((entry) => {
      const resolved = mediaByPublicId.get(entry.mediaPublicId);
      if (!resolved) return [];
      return [
        {
          media: toMediaSummaryDTO(resolved),
          score: entry.score,
          ankiCount: entry.ankiCount,
          playCount: entry.playCount,
          shareCount: entry.shareCount,
        },
      ];
    }),
  });
};

export const clearFamiliarMedia: ClearFamiliarMedia = async (_params, respond, req) => {
  const user = assertUser(req);

  // Only this table. Clearing activity history leaves the tally standing and
  // vice versa -- that separation is the point of storing them apart.
  const count = await UserMediaAffinity.clearForUser(user.id);

  return respond.with200().body({ count });
};
