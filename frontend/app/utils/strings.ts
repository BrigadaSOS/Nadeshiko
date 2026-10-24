/**
 * First value that actually says something, or `undefined` if none do.
 *
 * Media rows are not guaranteed to carry all three names -- plenty of YouTube and
 * live action entries have no romaji, and some have no English title -- so reading
 * one field directly yields `''` rather than a missing value. Passed on to an API
 * that distinguishes absent from empty, that `''` is a lie: it claims a name
 * exists and that it is blank.
 */
export const firstNonBlank = (...values: Array<string | null | undefined>): string | undefined =>
  values.find((value) => value !== null && value !== undefined && value.trim() !== '') ?? undefined;

/**
 * `value` when it is an absolute http(s) URL, otherwise `null`. Submitted links reach `href`, where a
 * `javascript:` URL would run in the viewer's session -- including an admin's.
 */
export function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
