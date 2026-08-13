/**
 * Collapses a blank string to `null`.
 *
 * Optional metadata a client attaches to a record is either present and says
 * something, or absent. `''` is the second case written as the first, and storing
 * it verbatim is what turns an empty field into an outage: the response schemas
 * mark these fields `nullable` with `minLength: 1`, so one empty column makes the
 * whole page fail serialization rather than the single row degrade.
 *
 * Whitespace-only counts as blank -- a name of `"   "` renders as an empty label
 * for the same reason `''` does. A value that survives is returned unchanged;
 * this normalizes presence, it does not rewrite content.
 */
export const blankToNull = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && value.trim() !== '' ? value : null;
