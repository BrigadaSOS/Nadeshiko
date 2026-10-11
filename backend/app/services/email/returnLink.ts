import { config } from '@config/config';
import { encryptSecret, decryptSecret } from '@lib/secretBox';
import { Cache, createCacheNamespace } from '@lib/cache';
import { LIFECYCLE_KINDS, type LifecycleKind } from '@app/models';

/** Wrap lifecycle links to attribute clicks server-side, and never add a state-changing side effect to a GET that
 * scanners can fetch. */

/** Where the wrapped links point. Registered by hand in `config/routes.ts`. */
export const EMAIL_LINK_PATH = '/v1/email/link';

/** Redirect everyone but pass an analytics-suppression flag for classified scanners; a false classification must not
 * break arrival. */
export const ANALYTICS_SUPPRESSED_PARAM = 'nb';

const RETURN_LINK_CONTEXT = { purpose: 'email.return-link' } as const;

/** Derive a separate return-link key from the shared secret so click and unsubscribe tokens cannot be exchanged. */
function returnLinkSecret(): string {
  return config.BETTER_AUTH_SECRET;
}

export interface ReturnIntent {
  userId: number;
  kind: LifecycleKind;
  campaign: string;
}

export function issueReturnToken(intent: ReturnIntent): string {
  const payload = JSON.stringify({ u: intent.userId, k: intent.kind, c: intent.campaign });
  return encryptSecret(payload, returnLinkSecret(), RETURN_LINK_CONTEXT);
}

/** Malformed, forged, or rewritten tokens return null rather than throwing; the redirect path must fail closed
 * without an error page. */
export function readReturnToken(token: unknown): ReturnIntent | null {
  if (typeof token !== 'string' || !token) return null;

  try {
    const parsed = JSON.parse(decryptSecret(token, returnLinkSecret(), RETURN_LINK_CONTEXT)) as {
      u?: unknown;
      k?: unknown;
      c?: unknown;
    };

    const userId = typeof parsed.u === 'number' && Number.isInteger(parsed.u) ? parsed.u : null;
    const kind = LIFECYCLE_KINDS.find((candidate) => candidate === parsed.k) ?? null;
    const campaign = typeof parsed.c === 'string' && parsed.c ? parsed.c : null;

    if (userId === null || kind === null || campaign === null) return null;

    return { userId, kind, campaign };
  } catch {
    return null;
  }
}

/** Keep the destination path outside the sealed token so every message link shares account/campaign identity for
 * scanner detection; validate the path on redirect. */
export function returnUrl(input: ReturnIntent & { path: string; content: string }): string {
  const url = new URL(EMAIL_LINK_PATH, config.BASE_URL);
  url.searchParams.set('t', issueReturnToken(input));
  url.searchParams.set('to', input.path);
  url.searchParams.set('c', input.content);
  return url.toString();
}

/** Tag lifecycle destinations, never unsubscribe links: an opt-out is not campaign engagement, and tags are applied
 * by the redirect. */
export function withCampaignTags(path: string, campaign: string, content: string): string {
  const url = new URL(path, config.BASE_URL);
  url.searchParams.set('utm_source', 'nadeshiko');
  url.searchParams.set('utm_medium', 'email');
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  return url.toString();
}

/** Validate the public destination against the site origin; reject protocol-relative and backslash forms to prevent
 * an open redirect. */
export function resolveDestination(to: unknown, campaign: string, content: string): string | null {
  if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//') || to.includes('\\')) return null;

  let destination: URL;
  try {
    destination = new URL(to, config.BASE_URL);
  } catch {
    return null;
  }

  if (destination.origin !== new URL(config.BASE_URL).origin) return null;

  return withCampaignTags(`${destination.pathname}${destination.search}`, campaign, content);
}

/** Marks a destination so the frontend skips analytics for that load. */
export function withAnalyticsSuppressed(destination: string): string {
  const url = new URL(destination);
  url.searchParams.set(ANALYTICS_SUPPRESSED_PARAM, '1');
  return url.toString();
}

/** Keep burst detection in memory per process: a short redirect path may trade one false classification for avoiding
 * a shared-cache round trip. */
export const LINK_BURST_CACHE = createCacheNamespace('email.link-burst', 5_000);

/** Use a short burst window to distinguish scanner fan-out from ordinary tabbed reading. */
export const BURST_WINDOW_MS = 15_000;
export const BURST_DISTINCT_LINKS = 3;

export type HitVerdict =
  /** A click we believe a person made. The only verdict that is recorded. */
  | 'human'
  /** The client said so itself, via a prefetch or preview header. */
  | 'prefetch'
  /** This link again, from the same message. Real, but not a new click. */
  | 'repeat'
  /** Too many different links from one message, too fast, to be a reader. */
  | 'fan-out';

interface Burst {
  startedAt: number;
  contents: string[];
}

/** Classify the hit only for analytics; key it by account and campaign, and never withhold the redirect from a
 * reader. */
export function classifyHit(intent: ReturnIntent, content: string, prefetch: boolean, now = Date.now()): HitVerdict {
  if (prefetch) return 'prefetch';

  const key = `${intent.userId}:${intent.campaign}`;
  const existing = Cache.get<Burst>(LINK_BURST_CACHE, key);
  const burst: Burst =
    existing && now - existing.startedAt <= BURST_WINDOW_MS ? existing : { startedAt: now, contents: [] };

  const seen = burst.contents.includes(content);
  if (!seen) burst.contents.push(content);

  // Keep the original window end; refreshing the full TTL on every hit would turn a burst into a rolling window.
  const remaining = burst.startedAt + BURST_WINDOW_MS - now;
  if (remaining > 0) Cache.set(LINK_BURST_CACHE, key, burst, remaining);

  if (seen) return 'repeat';
  if (burst.contents.length >= BURST_DISTINCT_LINKS) return 'fan-out';

  return 'human';
}
