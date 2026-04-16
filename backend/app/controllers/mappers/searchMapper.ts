import type { t_IncludeExpansion } from 'generated/models';

export const SearchInclude = {
  MEDIA: 'media',
} as const;

type SearchIncludesResponse = {
  includes?: {
    media?: Record<string, unknown>;
  };
};

export const shouldIncludeSearchMedia = (include?: t_IncludeExpansion[]): boolean =>
  include?.includes(SearchInclude.MEDIA) ?? false;

export const toSearchResponseDTO = <T extends SearchIncludesResponse>(result: T, include?: t_IncludeExpansion[]): T => {
  if (shouldIncludeSearchMedia(include)) {
    return result;
  }

  const { includes, ...rest } = result;
  return rest as T;
};
