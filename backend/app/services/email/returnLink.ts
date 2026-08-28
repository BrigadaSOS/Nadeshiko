import { config } from '@config/config';
import { encryptSecret, decryptSecret } from '@lib/secretBox';
import { Cache, createCacheNamespace } from '@lib/cache';
import { LIFECYCLE_KINDS, type LifecycleKind } from '@app/models';

/**
 * Every link in a lifecycle email, wrapped so the click is attributable to the
 * account we sent it to.
 *
 * WHY A REDIRECT WHEN THE LINKS WERE ALREADY TAGGED. `utm_*` is a claim the
 * BROWSER has to carry back to us, and the first dormant send showed both ways
 * that fails. The one reader who came back arrived `$direct` with the tags
 * gone -- pasted or retyped rather than clicked -- so the visit could not be
 * joined to the send at all. Meanwhile 45 tagged hits arrived from eighteen
 * anonymous browsers that never signed in: nine of them walked nine different
 * links inside twelve seconds, which is a mail scanner opening everything in
 * the message before the recipient has seen it.
 *
 * So attribution moves to the one place that cannot be stripped, forwarded or
 * faked: the link resolves HERE, against a sealed token naming the account, and
 * the click is recorded server-side under the same distinct id
 * `captureEmailSent` used. The tags are still applied to the destination, so
 * web analytics keeps working -- they are just no longer what the campaign is
 * measured on.
 *
 * NOTHING HERE HAS A SIDE EFFECT ON GET, which is the same rule
 * `getEmailPreferencesByToken` follows and for the same reason: anything a
 * scanner can reach by fetching a URL, a scanner WILL reach. This endpoint
 * records an analytics event and redirects. It does not sign anybody in, and it
 * must not be extended to -- a session minted on GET is a session handed to
 * whatever fetched the link first, which on the evidence above is a robot in
 * somebody else's data centre.
 */

/** Where the wrapped links point. Registered by hand in `config/routes.ts`. */
export const EMAIL_LINK_PATH = '/v1/email/link';

/**
 * Tells the frontend not to start analytics for this load.
 *
 * The redirect is issued to EVERYBODY, including hits we are confident are
 * machines -- see `classifyHit` for why refusing them is not on the table. This
 * is what stops a scanner that follows the redirect from becoming a person in
 * PostHog: it renders, it just never loads the SDK, so there is no anonymous
 * device id and no `$pageview`.
 *
 * Deliberately cheap to get wrong in both directions. A misjudged reader loses
 * one pageview; a misjudged scanner costs one phantom person. Neither is worth
 * breaking a link over.
 */
export const ANALYTICS_SUPPRESSED_PARAM = 'nb';

const RETURN_LINK_CONTEXT = { purpose: 'email.return-link' } as const;

/**
 * The same secret the unsubscribe token uses, for the reason given there: it is
 * the one value guaranteed to be set in every environment, and "unset" here
 * would mean every link in every lifecycle email is dead.
 *
 * The purpose string derives a separate key (`keyFor`), so a return token can
 * never be spent as an unsubscribe and an unsubscribe token can never be spent
 * as a click.
 */
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

/**
 * Opens a token, or answers null for anything we cannot place.
 *
 * NEVER THROWS, because the caller is a redirect a reader is waiting on. A
 * forged token, a corrupt one, and one a mail client has helpfully rewritten all
 * arrive here looking the same, and the answer to all three is to stop trusting
 * it -- not to show somebody who clicked a link in their email an error page.
 */
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

/**
 * A link for an email: our redirect, carrying who it was sent to and where they
 * were going.
 *
 * The destination travels as a PATH rather than sealed into the token, so one
 * token serves every link in a message. That is not only smaller -- it is what
 * makes `classifyHit` able to see a scanner walking the whole email, since every
 * link resolves to the same account and campaign.
 *
 * The path is checked on the way back out (`resolveDestination`), not here.
 */
export function returnUrl(input: ReturnIntent & { path: string; content: string }): string {
  const url = new URL(EMAIL_LINK_PATH, config.BASE_URL);
  url.searchParams.set('t', issueReturnToken(input));
  url.searchParams.set('to', input.path);
  url.searchParams.set('c', input.content);
  return url.toString();
}

/**
 * Every link in a lifecycle email is tagged, so a visit that started in the
 * inbox is attributable in PostHog -- which auto-captures `utm_*` on pageview,
 * so there is nothing to add on the frontend.
 *
 * NEVER APPLIED TO THE UNSUBSCRIBE LINK. That click is somebody leaving; filing
 * it as campaign traffic would count an opt-out as engagement and flatter
 * exactly the send that earned it.
 *
 * Lives here rather than in `emailTemplates` because the tags are now applied at
 * the REDIRECT, to the destination it hands back -- the address in the message
 * is `EMAIL_LINK_PATH`. `emailTemplates` re-exports it for the messages that
 * still tag a link directly.
 */
export function withCampaignTags(path: string, campaign: string, content: string): string {
  const url = new URL(path, config.BASE_URL);
  url.searchParams.set('utm_source', 'nadeshiko');
  url.searchParams.set('utm_medium', 'email');
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  return url.toString();
}

/**
 * Where a click actually goes, or null if the `to` we were handed is not
 * somewhere we are willing to send anybody.
 *
 * AN OPEN REDIRECT IS THE ONE BUG THIS FILE COULD PLAUSIBLY SHIP. The path is a
 * query parameter on a public, unauthenticated URL, so anybody can put anything
 * there; without this it becomes a nadeshiko.co address that forwards to
 * wherever a phisher likes, which is exactly the primitive a phisher wants from
 * us. Three checks rather than one, because each catches what the others miss:
 * a leading `//` is protocol-relative and parses as another host, a backslash is
 * treated as a slash by some clients but not by `URL`, and the origin
 * comparison is the backstop for whatever the first two did not anticipate.
 */
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

/**
 * In-memory and per-process, which is the right shape for what it holds. A burst
 * is fifteen seconds of one message being opened; losing it to a restart costs
 * at most one misjudged hit, and sharing it between instances would cost a round
 * trip on a redirect somebody is waiting on.
 *
 * Exported so the suite can clear it between cases -- the entries outlive a test
 * otherwise, since their TTL runs on the real clock while the window logic runs
 * on the timestamp it is handed.
 */
export const LINK_BURST_CACHE = createCacheNamespace('email.link-burst', 5_000);

/**
 * How long a run of hits on one message counts as a single burst, and how many
 * distinct links inside it stop looking like a reader.
 *
 * THREE IN FIFTEEN SECONDS, and both numbers are set against real traffic
 * rather than picked. The scanner we caught fetched nine distinct links in
 * twelve seconds; a reader middle-clicking two covers into tabs is ordinary
 * behaviour and must survive. Three inside fifteen seconds is above anything a
 * person does with a mouse and well below what the scanner did.
 */
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

/**
 * What to make of one hit.
 *
 * NOTHING HERE WITHHOLDS THE REDIRECT, and that asymmetry is deliberate. Being
 * wrong about a scanner costs one phantom person in PostHog, which is a row in a
 * query. Being wrong about a reader would mean somebody who clicked a link in a
 * win-back email got a blank page -- from the campaign whose entire purpose is
 * that they came back. The verdict gates whether the click is RECORDED and
 * whether the destination loads analytics; it never gates arrival.
 *
 * Keyed on the account and campaign rather than the token string, because
 * `issueReturnToken` seals with a random nonce and so returns a different string
 * every call -- two links in the same message do not share a token, but they do
 * share the reader they were sent to.
 */
export function classifyHit(intent: ReturnIntent, content: string, prefetch: boolean, now = Date.now()): HitVerdict {
  if (prefetch) return 'prefetch';

  const key = `${intent.userId}:${intent.campaign}`;
  const existing = Cache.get<Burst>(LINK_BURST_CACHE, key);
  const burst: Burst =
    existing && now - existing.startedAt <= BURST_WINDOW_MS ? existing : { startedAt: now, contents: [] };

  const seen = burst.contents.includes(content);
  if (!seen) burst.contents.push(content);

  // The remaining life of the window, NOT a fresh one. Re-setting the full TTL
  // on every hit would turn a burst into a rolling window that a reader
  // returning to the message every ten seconds could extend indefinitely, until
  // their third unhurried click was filed as a machine.
  const remaining = burst.startedAt + BURST_WINDOW_MS - now;
  if (remaining > 0) Cache.set(LINK_BURST_CACHE, key, burst, remaining);

  if (seen) return 'repeat';
  if (burst.contents.length >= BURST_DISTINCT_LINKS) return 'fan-out';

  return 'human';
}
