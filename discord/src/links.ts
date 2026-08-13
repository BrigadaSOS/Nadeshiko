import { recordLinkEmitted } from './analytics';
import { BOT_CONFIG } from './config';

/**
 * Every frontend link the bot hands out is built here, so a change to the
 * frontend's routing is a one-file change.
 *
 * It is also where Discord -> Nadeshiko attribution comes from, which is worth
 * explaining because the alternative looks like it should work and does not.
 * Discord clients strip the referrer, so a click from a bot embed arrives at
 * nadeshiko.co as `$direct` -- indistinguishable from someone typing the URL.
 * PostHog's referring-domain breakdown for this project confirms it: `$direct`,
 * `nadeshiko.co`, `immersionkit.com`, `chatgpt.com`, `google.com`, and no
 * `discord.com` at any volume. So the link has to carry its own provenance, and
 * a UTM triple is the one mechanism the frontend already understands without
 * any change on that side -- posthog-js reads utm_* into `$pageview` and onto
 * the person's initial properties for free.
 *
 * ATTRIBUTION IS ON BY DEFAULT AND MUST BE OPTED OUT OF. The failure mode of
 * the reverse (a new link that quietly is not tracked) is invisible for months;
 * the failure mode of this one -- an internal fetch tagged as a user click --
 * is loud and shows up as impossible traffic. `/health` is the one real opt-out
 * and says so at its call site.
 */

export type LinkTarget = 'home' | 'about' | 'stats' | 'sentence' | 'search' | 'media' | 'episode';

export type LinkAttribution = {
  /** Becomes `utm_campaign`: the command or feature the link came from. */
  surface?: string;
  /** Set false for links the bot fetches itself rather than hands to a user. */
  attribution?: boolean;
};

export type SearchLinkOptions = {
  query?: string;
  mediaPublicId?: string;
  /** Restricts the search to these episodes of `mediaPublicId`. */
  episodes?: number[];
};

function attribute(url: string, target: LinkTarget, link: LinkAttribution = {}): string {
  const { surface = 'bot', attribution = true } = link;
  if (!attribution) return url;

  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', 'discord');
  parsed.searchParams.set('utm_medium', 'bot');
  parsed.searchParams.set('utm_campaign', surface);
  // `utm_content` distinguishes the kind of destination within one surface --
  // a /search reply carries both a media link and a sentence link, and "which
  // link do people actually click" is the question this exists to answer.
  parsed.searchParams.set('utm_content', target);

  // The denominator for click-through rate. PostHog counts the arrivals; this
  // counts what was offered. Neither is meaningful alone.
  recordLinkEmitted({ target, surface });

  return parsed.toString();
}

export function homeUrl(link?: LinkAttribution): string {
  return attribute(BOT_CONFIG.frontendUrl, 'home', link);
}

export function aboutUrl(link?: LinkAttribution): string {
  return attribute(`${BOT_CONFIG.frontendUrl}/about`, 'about', link);
}

export function statsUrl(link?: LinkAttribution): string {
  return attribute(`${BOT_CONFIG.frontendUrl}/stats`, 'stats', link);
}

export function sentenceUrl(segmentPublicId: string, link?: LinkAttribution): string {
  return attribute(`${BOT_CONFIG.frontendUrl}/sentence/${segmentPublicId}`, 'sentence', link);
}

export function searchUrl(options: SearchLinkOptions = {}, link?: LinkAttribution): string {
  const { query, mediaPublicId, episodes } = options;
  const base = query
    ? `${BOT_CONFIG.frontendUrl}/search/${encodeURIComponent(query)}`
    : `${BOT_CONFIG.frontendUrl}/search`;

  const params = new URLSearchParams();
  if (mediaPublicId) params.set('media', mediaPublicId);
  if (episodes?.length) params.set('episode', episodes.join(','));

  const qs = params.toString();
  const url = qs ? `${base}?${qs}` : base;

  return attribute(url, episodes?.length ? 'episode' : mediaPublicId ? 'media' : 'search', link);
}

/** Search restricted to one media, optionally to a single episode of it. */
export function mediaSearchUrl(mediaPublicId: string, episode?: number, link?: LinkAttribution): string {
  return searchUrl({ mediaPublicId, episodes: episode == null ? undefined : [episode] }, link);
}
