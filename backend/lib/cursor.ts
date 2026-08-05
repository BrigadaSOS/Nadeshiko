import { InvalidRequestError } from '@app/errors';

type OffsetCursorPayload = {
  kind: 'offset';
  skip: number;
};

type KeysetCursorPayload<TCursor> = {
  kind: 'keyset';
  cursor: TCursor;
};

function encodeCursorPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursorPayload<T>(cursor: string): T {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(decoded) as T;
  } catch {
    throw new InvalidRequestError('Invalid cursor');
  }
}

/**
 * A cursor only means something within the result set that produced it.
 *
 * `GET /v1/media` paginates by keyset while browsing and by offset once a
 * `query` is supplied, so a client that pages and *then* types a search term
 * carries a cursor of the wrong kind into the other branch. Rejecting it with a
 * 400 mid-browse is unhelpful — adding a search term produces a different
 * result set, so the old position is meaningless either way. Callers use this to
 * drop a mismatched cursor and start from the beginning.
 */
export function cursorMatchesKind(cursor: string | null | undefined, kind: 'offset' | 'keyset'): boolean {
  if (!cursor) return false;
  try {
    return decodeCursorPayload<{ kind?: unknown }>(cursor).kind === kind;
  } catch {
    // Malformed cursors stay the decoder's problem, so the caller still 400s.
    return true;
  }
}

export function encodeOffsetCursor(skip: number): string {
  if (!Number.isInteger(skip) || skip < 0) {
    throw new InvalidRequestError('Invalid offset cursor value');
  }
  return encodeCursorPayload({ kind: 'offset', skip } satisfies OffsetCursorPayload);
}

export function decodeOffsetCursor(cursor?: string | null): number {
  if (!cursor) {
    return 0;
  }

  const payload = decodeCursorPayload<OffsetCursorPayload>(cursor);
  if (payload.kind !== 'offset' || !Number.isInteger(payload.skip) || payload.skip < 0) {
    throw new InvalidRequestError('Invalid offset cursor');
  }

  return payload.skip;
}

export function encodeKeysetCursor<TCursor>(cursor: TCursor): string {
  return encodeCursorPayload({ kind: 'keyset', cursor } satisfies KeysetCursorPayload<TCursor>);
}

export function decodeKeysetCursor<TCursor>(cursor?: string | null): TCursor | undefined {
  if (!cursor) {
    return undefined;
  }

  const payload = decodeCursorPayload<KeysetCursorPayload<TCursor>>(cursor);
  if (payload.kind !== 'keyset') {
    throw new InvalidRequestError('Invalid keyset cursor');
  }
  return payload.cursor;
}
