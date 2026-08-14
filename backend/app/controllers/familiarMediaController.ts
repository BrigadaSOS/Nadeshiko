import type { ListFamiliarMedia } from 'generated/routes/activity';
import type { ClearFamiliarMedia, ForgetFamiliarMedia } from 'generated/routes/user';
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

/**
 * Forgets a single title from the reader's tally.
 *
 * Answers with the row count it removed rather than 404ing on a title that was
 * never tallied: the caller is a reader pressing a button beside a list, and
 * "there was nothing to forget" is the same outcome to them as "forgotten".
 * Only rows belonging to this reader are in scope, so the id in the path cannot
 * reach anybody else's tally.
 */
export const forgetFamiliarMedia: ForgetFamiliarMedia = async ({ params }, respond, req) => {
  const user = assertUser(req);

  const count = await UserMediaAffinity.forgetForUser(user.id, params.mediaPublicId);

  return respond.with200().body({ count });
};
