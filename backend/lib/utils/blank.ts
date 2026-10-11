/** Normalize empty or whitespace-only optional metadata to null so response schemas with `nullable` and `minLength:
 * 1` cannot fail an entire page; preserve nonblank content unchanged. */
export const blankToNull = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && value.trim() !== '' ? value : null;
