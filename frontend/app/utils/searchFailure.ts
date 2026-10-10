export type SearchFailureKind = 'invalid-request' | 'rate-limited' | 'quota-exceeded' | 'not-found' | 'unavailable';

/** The only error data allowed in component state and the SSR payload. */
export type SearchFailure = { kind: SearchFailureKind };
export type SearchFetchScope = 'corpus' | 'collection' | 'segment';

// These keys belong to the frontend, never to a response body or exception message.
export const SEARCH_FAILURE_MESSAGES: Record<SearchFailureKind, { title: string; message: string }> = {
  'invalid-request': { title: 'searchErrors.invalidRequest.title', message: 'searchErrors.invalidRequest.message' },
  'rate-limited': { title: 'searchErrors.rateLimited.title', message: 'searchErrors.rateLimited.message' },
  'quota-exceeded': { title: 'searchErrors.quotaExceeded.title', message: 'searchErrors.quotaExceeded.message' },
  'not-found': { title: 'searchpage.main.labels.noresults', message: 'segment.noResultsMessage' },
  unavailable: { title: 'searchErrors.unavailable.title', message: 'searchErrors.unavailable.message' },
};

export function classifySearchFailure(
  status: number | undefined,
  scope: SearchFetchScope,
  rateLimitReason?: string | null,
): SearchFailure {
  if (status === 429) {
    return { kind: rateLimitReason === 'monthly_quota' ? 'quota-exceeded' : 'rate-limited' };
  }
  // On identifier lookups, a malformed id is rejected before looking anything up.
  if (status === 404 || (status === 400 && scope !== 'corpus')) {
    return { kind: 'not-found' };
  }
  if (status === 400) return { kind: 'invalid-request' };
  return { kind: 'unavailable' };
}

export function canRetrySearchFailure(failure: SearchFailure): boolean {
  return failure.kind === 'unavailable';
}
