import { BOT_CONFIG } from './config';

/**
 * Every frontend link the bot hands out is built here, so a change to the
 * frontend's routing is a one-file change.
 */

export type SearchLinkOptions = {
  query?: string;
  mediaPublicId?: string;
  /** Restricts the search to these episodes of `mediaPublicId`. */
  episodes?: number[];
};

export function homeUrl(): string {
  return BOT_CONFIG.frontendUrl;
}

export function aboutUrl(): string {
  return `${BOT_CONFIG.frontendUrl}/about`;
}

export function statsUrl(): string {
  return `${BOT_CONFIG.frontendUrl}/stats`;
}

export function sentenceUrl(segmentPublicId: string): string {
  return `${BOT_CONFIG.frontendUrl}/sentence/${segmentPublicId}`;
}

export function searchUrl(options: SearchLinkOptions = {}): string {
  const { query, mediaPublicId, episodes } = options;
  const base = query
    ? `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(query)}`
    : `${BOT_CONFIG.frontendUrl}/search`;

  const params = new URLSearchParams();
  if (mediaPublicId) params.set('media', mediaPublicId);
  if (episodes?.length) params.set('episode', episodes.join(','));

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Search restricted to one media, optionally to a single episode of it. */
export function mediaSearchUrl(mediaPublicId: string, episode?: number): string {
  return searchUrl({ mediaPublicId, episodes: episode == null ? undefined : [episode] });
}
