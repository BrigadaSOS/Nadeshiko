import type { SearchFilters, SearchRequest, SearchStatsRequest, SearchWordsData } from '@brigadasos/nadeshiko-sdk';

type SortMode = NonNullable<NonNullable<SearchRequest['sort']>['mode']>;

const LEGACY_SORT_MODE_MAP: Record<string, SortMode> = {
  asc: 'ASC',
  desc: 'DESC',
  none: 'NONE',
  time_asc: 'TIME_ASC',
  time_desc: 'TIME_DESC',
  random: 'RANDOM',
  ASC: 'ASC',
  DESC: 'DESC',
  NONE: 'NONE',
  TIME_ASC: 'TIME_ASC',
  TIME_DESC: 'TIME_DESC',
  RANDOM: 'RANDOM',
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === 'string');
  return values.length > 0 ? values : undefined;
}

export function normalizeSearchFilters(value: unknown): SearchFilters | undefined {
  const filters = asObject(value);
  if (Object.keys(filters).length === 0) {
    return undefined;
  }

  const normalized: Record<string, unknown> = { ...filters };
  if (normalized.segmentLengthChars === undefined && normalized.segmentLength !== undefined) {
    normalized.segmentLengthChars = normalized.segmentLength;
  }
  delete normalized.segmentLength;

  return normalized as SearchFilters;
}

export function normalizeSearchRequest(value: unknown): SearchRequest {
  const body = asObject(value);
  const queryValue = body.query;
  const queryObject = asObject(queryValue);

  const querySearch = asString(queryValue) ?? asString(queryObject.search) ?? asString(body.uuid);
  const queryExactMatch =
    typeof body.exactMatch === 'boolean'
      ? body.exactMatch
      : typeof queryObject.exactMatch === 'boolean'
        ? queryObject.exactMatch
        : undefined;

  const sortValue = body.sort;
  const sortObject = asObject(sortValue);
  const legacyMode = asString(sortValue);
  const sortMode = LEGACY_SORT_MODE_MAP[legacyMode ?? ''] ?? asString(sortObject.mode);
  const randomSeed = asNumber(body.randomSeed);
  const sortSeed = asNumber(sortObject.seed) ?? randomSeed;
  const shouldUseRandom = sortMode === 'RANDOM' || (sortMode === undefined && sortSeed !== undefined);

  const query =
    querySearch || queryExactMatch !== undefined ? { search: querySearch, exactMatch: queryExactMatch } : undefined;
  const sort =
    sortMode || shouldUseRandom || sortSeed !== undefined
      ? {
          mode: (shouldUseRandom ? 'RANDOM' : sortMode) as SortMode | undefined,
          seed: sortSeed,
        }
      : undefined;

  return {
    limit: asNumber(body.limit),
    cursor: Array.isArray(body.cursor) ? (body.cursor as number[]) : undefined,
    query,
    sort,
    filters: normalizeSearchFilters(body.filters),
    include: (asStringArray(body.include) as SearchRequest['include']) ?? ['media'],
  };
}

export function normalizeSearchStatsRequest(value: unknown): SearchStatsRequest {
  const body = asObject(value);
  const queryValue = body.query;
  const queryObject = asObject(queryValue);

  const querySearch = asString(queryValue) ?? asString(queryObject.search);
  const queryExactMatch =
    typeof body.exactMatch === 'boolean'
      ? body.exactMatch
      : typeof queryObject.exactMatch === 'boolean'
        ? queryObject.exactMatch
        : undefined;

  return {
    query:
      querySearch || queryExactMatch !== undefined
        ? {
            search: querySearch,
            exactMatch: queryExactMatch,
          }
        : undefined,
    filters: normalizeSearchFilters(body.filters),
    include: (asStringArray(body.include) as SearchStatsRequest['include']) ?? ['media'],
  };
}

export function normalizeSearchWordsBody(value: unknown): SearchWordsData['body'] {
  const body = asObject(value);
  const queryObject = asObject(body.query);

  const words = asStringArray(body.words) ?? asStringArray(queryObject.words) ?? [];
  const exactMatch =
    typeof body.exactMatch === 'boolean'
      ? body.exactMatch
      : typeof queryObject.exactMatch === 'boolean'
        ? queryObject.exactMatch
        : undefined;

  return {
    query: {
      words,
      exactMatch,
    },
    filters: normalizeSearchFilters(body.filters),
    include: (asStringArray(body.include) as SearchWordsData['body']['include']) ?? ['media'],
  };
}
