import { SegmentDocument } from '@app/models/SegmentDocument';
import { UserActivity, ActivityType } from '@app/models/UserActivity';
import type { Search, GetSearchStats, SearchWords } from 'generated/routes/search';
import { toSearchResponseDTO } from './mappers/search.mapper';
import { logger } from '@config/log';

export const search: Search = async ({ body }, respond, req) => {
  const searchResults = await SegmentDocument.search(body);
  trackSearchActivity(req.user, body.query?.search, body.cursor);
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};

export const getSearchStats: GetSearchStats = async ({ body }, respond) => {
  const stats = await SegmentDocument.searchStats(body);
  return respond.with200().body(toSearchResponseDTO(stats, body.include));
};

export const searchWords: SearchWords = async ({ body }, respond) => {
  const searchResults = await SegmentDocument.wordsMatched(body.query.words, body.query.exactMatch, body.filters);
  return respond.with200().body(toSearchResponseDTO(searchResults, body.include));
};

type SearchTrackableUser = Parameters<typeof UserActivity.trackForUser>[0];

function trackSearchActivity(user: SearchTrackableUser | undefined, searchQuery: string | undefined, cursor?: string) {
  // Track only initial searches; pagination cursors are not new search actions.
  if (!user || !searchQuery || cursor) {
    return;
  }

  UserActivity.trackForUser(user, ActivityType.SEARCH, { searchQuery }).catch((err: unknown) => {
    logger.warn({ err, userId: user.id }, 'Failed to track search activity');
  });
}
