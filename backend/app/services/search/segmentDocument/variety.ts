import type { estypes } from '@elastic/elasticsearch';
import { InvalidRequestError } from '@app/errors';
import type { ResolvedFilters, SearchRequestInput } from './searchInputs';

/**
 * Keeps one title from filling the top of a relevance search.
 *
 * A word with few results is often swamped by the one show that uses it most,
 * usually in one sense -- a character's name, say, burying the ordinary word.
 * So the default relevance order is served in rounds: round 1 is the best
 * sentence of every title, round 2 the second best of every title, and then
 * everything else in plain relevance order. Inside a round, titles go in the
 * relevance order of the sentence they contribute. Each season is its own
 * title (`mediaId`), deliberately.
 *
 * Titles the reader starred (`preferMedia`) come first as a block of their
 * own -- their rounds, then the rest of their sentences -- and everything else
 * follows as a second block shaped the same way. Without stars there is just
 * the one block.
 *
 * Common words already come back spread over many titles, so for them this
 * changes nothing; it only acts where one title dominates.
 *
 * Each round is one collapse query (no inner hits) over the query *without*
 * the reader's stars, so every reader shares the cached lists; the stars only
 * decide which block an entry falls in. "The rest" is the ordinary keyset
 * search with every round sentence excluded, so nothing appears twice.
 */
export const VARIETY_ROUNDS = 2;

/** Titles taken into the rounds. Beyond this, a title's sentences simply arrive in the rest phase. */
export const VARIETY_MAX_GROUPS = 2000;

export type RoundEntry = {
  /** Elasticsearch `_id`, the segment id. */
  id: string;
  mediaId: number;
  round: number;
  sort: estypes.FieldValue[];
};

/** `fav`: the reader's starred titles. `all`: every other title. */
export type VarietyBlock = 'fav' | 'all';

export type RoundsCursor = {
  kind: 'variety';
  block: VarietyBlock;
  phase: 'rounds';
  round: number;
  sort: estypes.FieldValue[];
};
export type RestCursor = { kind: 'variety'; block: VarietyBlock; phase: 'rest'; after: estypes.FieldValue[] | null };
export type VarietyCursor = RoundsCursor | RestCursor;

/**
 * Only the default order, only with a word to search, and only when there is
 * more than one title to spread over. An explicit sort is the reader asking
 * for that order, and a single-title scope has nothing to vary.
 */
export function shouldDiversify(
  request: Pick<SearchRequestInput, 'sort'>,
  filters: ResolvedFilters,
  hasQuery: boolean,
): boolean {
  if (!hasQuery) return false;
  const mode = request.sort?.mode?.toLowerCase();
  if (mode && mode !== 'relevance') return false;
  const include = filters.media?.include;
  if (include && include.length === 1) return false;
  return true;
}

/** A comparator over Elasticsearch sort values, following the directions of `sort`. */
export function compareSortValues(sort: estypes.Sort) {
  const directions = (Array.isArray(sort) ? sort : [sort]).map((item) => {
    if (typeof item === 'string') return 1;
    const spec = Object.values(item)[0] as { order?: string } | string | undefined;
    const order = typeof spec === 'string' ? spec : spec?.order;
    return order === 'desc' ? -1 : 1;
  });

  return (a: estypes.FieldValue[], b: estypes.FieldValue[]): number => {
    for (let i = 0; i < directions.length; i++) {
      const x = a[i];
      const y = b[i];
      const direction = directions[i] ?? 1;
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (x < y) return -direction;
      if (x > y) return direction;
    }
    return 0;
  };
}

/**
 * Turns a collapse response -- one top-level hit per title, its best sentence,
 * already in sort order -- into one round's entries. Excluded sentences are
 * dropped, and their title simply has no entry in this round.
 */
export function buildRound(
  response: estypes.SearchResponse,
  round: number,
  excludedIds: ReadonlySet<string> = new Set(),
): RoundEntry[] {
  return response.hits.hits.flatMap((hit) => {
    const fromFields = (hit.fields as { mediaId?: unknown[] } | undefined)?.mediaId?.[0];
    const fromSource = (hit._source as { mediaId?: unknown } | undefined)?.mediaId;
    const mediaId = Number(fromFields ?? fromSource);
    if (!hit._id || !hit.sort || !Number.isFinite(mediaId) || excludedIds.has(hit._id)) return [];
    return [{ id: hit._id, mediaId, round, sort: hit.sort as estypes.FieldValue[] }];
  });
}

/** Index of the first entry after the one a rounds cursor points at. */
export function indexAfterCursor(entries: RoundEntry[], cursor: RoundsCursor, sort: estypes.Sort): number {
  const compare = compareSortValues(sort);
  // Keyset rather than an offset: if the list changed between two pages (the
  // cache expired and new content arrived), nothing already shown comes back.
  const index = entries.findIndex(
    (entry) => entry.round > cursor.round || (entry.round === cursor.round && compare(entry.sort, cursor.sort) > 0),
  );
  return index === -1 ? entries.length : index;
}

function encode(payload: VarietyCursor): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function encodeRoundsCursor(block: VarietyBlock, entry: RoundEntry): string {
  return encode({ kind: 'variety', block, phase: 'rounds', round: entry.round, sort: entry.sort });
}

export function encodeRestCursor(block: VarietyBlock, after: estypes.FieldValue[] | null): string {
  return encode({ kind: 'variety', block, phase: 'rest', after });
}

/**
 * Reads a variety cursor for a search sorted by `sortLength` fields. Returns
 * `undefined` for no cursor, and `'keyset'` for a plain keyset cursor -- one
 * issued before this ordering existed, which the caller keeps honouring in the
 * old order rather than failing a reader mid-scroll across a deploy.
 */
export function decodeVarietyCursor(
  cursor: string | null | undefined,
  sortLength: number,
): VarietyCursor | 'keyset' | undefined {
  if (!cursor) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidRequestError('Invalid cursor');
  }
  const p = payload as {
    kind?: unknown;
    block?: unknown;
    phase?: unknown;
    round?: unknown;
    sort?: unknown;
    after?: unknown;
  };
  if (p?.kind === 'keyset') return 'keyset';
  if (p?.kind !== 'variety' || (p.block !== 'fav' && p.block !== 'all')) {
    throw new InvalidRequestError('Invalid cursor');
  }
  const fitsSort = (values: unknown): values is estypes.FieldValue[] =>
    Array.isArray(values) && values.length === sortLength;
  if (p.phase === 'rounds' && Number.isInteger(p.round) && fitsSort(p.sort)) {
    return { kind: 'variety', block: p.block, phase: 'rounds', round: p.round as number, sort: p.sort };
  }
  if (p.phase === 'rest' && (p.after === null || fitsSort(p.after))) {
    return { kind: 'variety', block: p.block, phase: 'rest', after: p.after };
  }
  throw new InvalidRequestError('Invalid cursor: it must match the current sort configuration.');
}
