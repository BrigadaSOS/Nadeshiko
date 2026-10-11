import { Media } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { includedSearchLanguages } from '@lib/searchLanguages';
import type { t_MediaFilterItem, t_SearchFilters } from 'generated/models';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>['results'];

/** How many unresolved identifiers an error message names before it trails off. */
const MAX_REPORTED_UNKNOWN_MEDIA = 5;

/** Normalize the deprecated `exclude` shape; readers still accept both forms, so this is compatibility cleanup
 * rather than a prerequisite. */
export function normalizeLanguageFilter(filters?: t_SearchFilters): void {
  if (!filters || filters.languages == null) return;

  filters.languages = includedSearchLanguages(filters.languages);
}

/** Resolve public ids into a copy, leaving the request body intact for callers that need the original filter. */
export async function resolveMediaFilterIds<TFilters extends t_SearchFilters>(
  filters?: TFilters,
): Promise<ResolvedSearchFilters<TFilters> | undefined> {
  // No media filter means nothing to resolve; the result is vacuously resolved.
  if (!filters?.media) return filters as ResolvedSearchFilters<TFilters> | undefined;

  const { include, exclude } = filters.media;
  const hasItems = (include && include.length > 0) || (exclude && exclude.length > 0);
  if (!hasItems) return filters as ResolvedSearchFilters<TFilters>;

  const mediaInfo = await Media.getMediaInfoMap();
  const identifiers = buildMediaIdentifierIndex(mediaInfo.results);

  return {
    ...filters,
    media: {
      ...filters.media,
      ...(include ? { include: resolveIncludeItems(include, identifiers) } : {}),
      ...(exclude ? { exclude: resolveExcludeItems(exclude, identifiers) } : {}),
    },
  } as ResolvedSearchFilters<TFilters>;
}

/** Only `RELEVANCE` needs preference tie-breaking; explicit ordering and unresolvable saved titles must not be
 * changed into a preference sort. */
export async function resolvePreferredMediaIds(
  sort: { mode?: string } | undefined,
  preferMedia: string[] | undefined,
): Promise<ReadonlySet<number>> {
  if (!preferMedia || preferMedia.length === 0) return EMPTY_PREFERRED_MEDIA;

  const mode = sort?.mode?.toUpperCase();
  if (mode && mode !== 'RELEVANCE') return EMPTY_PREFERRED_MEDIA;

  const mediaInfo = await Media.getMediaInfoMap();
  const identifiers = buildMediaIdentifierIndex(mediaInfo.results);

  const resolved = new Set<number>();
  for (const publicId of preferMedia) {
    const mediaId = identifiers.get(publicId);
    if (mediaId !== undefined) resolved.add(mediaId);
  }

  return resolved;
}

const EMPTY_PREFERRED_MEDIA: ReadonlySet<number> = new Set<number>();

/** The internal id resolved from the public identifier; not part of the wire shape. */
export type ResolvedMediaFilterItem = t_MediaFilterItem & { mediaId: number };

/** Pass only filters whose media entries have resolved `mediaId`; the wire request carries `mediaPublicId`, and
 * unresolved ids would match nothing silently. */
export type ResolvedSearchFilters<TFilters extends t_SearchFilters = t_SearchFilters> = Omit<TFilters, 'media'> & {
  media?: Omit<NonNullable<TFilters['media']>, 'include' | 'exclude'> & {
    include?: ResolvedMediaFilterItem[];
    exclude?: ResolvedMediaFilterItem[];
  };
};

/** Report an unknown include id: dropping the last entry would turn a narrow request into an unfiltered corpus
 * search. */
function resolveIncludeItems(items: t_MediaFilterItem[], identifiers: Map<string, number>): ResolvedMediaFilterItem[] {
  const resolved: ResolvedMediaFilterItem[] = [];
  const unknown: string[] = [];

  for (const item of items) {
    if (!item) continue;

    const mediaId = identifiers.get(item.mediaPublicId);
    if (mediaId === undefined) {
      unknown.push(item.mediaPublicId);
      continue;
    }
    resolved.push({ ...item, mediaId });
  }

  if (unknown.length > 0) {
    const named = unknown.slice(0, MAX_REPORTED_UNKNOWN_MEDIA).join(', ');
    const rest =
      unknown.length > MAX_REPORTED_UNKNOWN_MEDIA ? ` (and ${unknown.length - MAX_REPORTED_UNKNOWN_MEDIA} more)` : '';
    throw new InvalidRequestError(`Unknown media in filters.media.include: ${named}${rest}`);
  }

  return resolved;
}

/** Excluding a media that does not exist excludes nothing, which is already the answer the
 *  caller asked for, so unresolved entries are dropped instead of rejected. */
function resolveExcludeItems(items: t_MediaFilterItem[], identifiers: Map<string, number>): ResolvedMediaFilterItem[] {
  const resolved: ResolvedMediaFilterItem[] = [];

  for (const item of items) {
    if (!item) continue;

    const mediaId = identifiers.get(item.mediaPublicId);
    if (mediaId !== undefined) resolved.push({ ...item, mediaId });
  }

  return resolved;
}

/** Index both identifiers once per request; public ids are inserted first so they win when values overlap an AniList
 * id. */
function buildMediaIdentifierIndex(mediaMap: MediaInfoMap): Map<string, number> {
  const identifiers = new Map<string, number>();

  for (const [id, info] of mediaMap) {
    identifiers.set(info.publicId, id);
  }

  for (const [id, info] of mediaMap) {
    const anilistId = info.externalIds?.anilist;
    if (anilistId && !identifiers.has(anilistId)) identifiers.set(anilistId, id);
  }

  return identifiers;
}
