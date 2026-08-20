import fs from 'fs';
import path from 'path';
import { config } from '@config/config';

function escapeHTML(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getLogoUrl(): string {
  return `${config.BASE_URL}/logo-38d6e06a.webp`;
}

export async function buildWelcomeEmail(username: string): Promise<{
  subject: string;
  html: string;
}> {
  const subject = 'Welcome to Nadeshiko!';
  const html = await renderTemplate('welcome', {
    username,
    baseUrl: config.BASE_URL,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

/**
 * `code` is optional and absent is a supported state, not a failure: if minting
 * one did not work, the link in this message still signs the reader in and the
 * code block simply is not there. See `mintLoginCode`.
 */
export async function buildMagicLinkEmail(
  url: string,
  code?: string | null,
): Promise<{ subject: string; html: string }> {
  const subject = 'Nadeshiko: Your sign-in link';
  const html = await renderTemplate('magic-link', {
    url,
    code: code ?? '',
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

export async function buildVerifyNewEmailEmail(url: string): Promise<{ subject: string; html: string }> {
  const subject = 'Nadeshiko: Verify your new email';
  const html = await renderTemplate('verify-new-email', {
    url,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

export interface FeedbackEmailInput {
  /** Who it came from, already resolved to something readable. */
  from: string;
  message: string;
  /** One `Key: value` per line. Rendered verbatim inside a `pre`. */
  context: string;
}

/**
 * The notification we send ourselves when someone uses the feedback widget.
 *
 * The subject leads with the sender and the opening words of the message, so a
 * mailbox list is already triageable without opening anything. Truncated hard,
 * because a subject line that runs on is worse than one that stops.
 */
export async function buildFeedbackEmail(input: FeedbackEmailInput): Promise<{ subject: string; html: string }> {
  const subject = `\u{1F4AC} Feedback from ${input.from}: ${truncate(collapseWhitespace(input.message), 60)}`;
  const html = await renderTemplate('feedback', {
    from: input.from,
    message: input.message,
    context: input.context,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

/** A newline in a subject line is a header-injection shape as well as an ugly one. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * How much of the site the reader has actually touched in their first week,
 * as far as we can honestly tell.
 *
 * `activityVisible` is the field that keeps this honest, and it is not optional.
 * `UserActivity` is written only for readers who leave `searchHistory` on, so a
 * reader who turned it off produces a row of zeroes that is indistinguishable
 * from a reader who signed up and never came back. Sending the second email to
 * the first is telling somebody who uses the site daily that they have not
 * started yet -- and the reason we cannot tell is that they asked us not to
 * keep the log, which makes it doubly bad. When it is false, nothing is
 * inferred and the neutral variant goes out.
 */
export interface OnboardingSignals {
  activityVisible: boolean;
  totalSearches: number;
  totalExports: number;
  /**
   * Whether they have ever saved an Anki profile.
   *
   * Read from preferences rather than from `UserActivity`, which means it is
   * known even for a reader who turned their history off -- the one signal here
   * that survives `activityVisible` being false.
   */
  hasAnkiProfile: boolean;
}

export type OnboardingVariant = 'getting-started' | 'anki' | 'anki-stalled' | 'going-further';

/**
 * Which day-7 email this reader should get.
 *
 * Ordered by how much it would help, not by how much they have done: never
 * searched is the biggest gap, never exported is the next, and somebody doing
 * both gets the one that assumes they are past the basics.
 *
 * THE SPLIT BETWEEN `anki` AND `anki-stalled` IS THE POINT OF THIS FUNCTION.
 * Both are readers with no exports, and they are stuck at opposite ends of the
 * same feature: one has never opened the settings, the other has saved a profile
 * and is being refused by AnkiConnect on their own machine. Of the 263 accounts
 * created in the 90 days to 2026-08-20, 102 had a profile and no export at all
 * against 107 who had both -- so telling that half to "set up Anki export", which
 * is what one variant for both did, is telling them to do the thing they already
 * did. See `ANKI_CONNECT_FAILURES` on the frontend for what actually stops them.
 */
export function pickOnboardingVariant(signals: OnboardingSignals): OnboardingVariant {
  // Their history is off, so searches and exports are both zero regardless of
  // what they have done, and nothing may be inferred from them. The profile is
  // the exception -- it is a preference, not a logged action -- and a saved
  // profile with a site we cannot see them using is still worth one nudge about
  // the connection, because that is the step that fails silently.
  if (!signals.activityVisible) return signals.hasAnkiProfile ? 'anki-stalled' : 'going-further';
  if (signals.totalSearches === 0) return 'getting-started';
  if (signals.totalExports === 0) return signals.hasAnkiProfile ? 'anki-stalled' : 'anki';
  return 'going-further';
}

interface Tip {
  title: string;
  body: string;
}

interface VariantCopy {
  subject: string;
  headline: string;
  intro: string;
  /**
   * Exactly three, as a tuple rather than an array: the template has three slots
   * and a fourth tip would silently not be sent. It also means the indices below
   * are known-present, which under `noUncheckedIndexedAccess` is the difference
   * between plain reads and six non-null assertions.
   */
  tips: [Tip, Tip, Tip];
  ctaLabel: string;
  ctaPath: string;
}

const ONBOARDING_COPY: Record<OnboardingVariant, VariantCopy> = {
  'getting-started': {
    subject: 'Getting started with Nadeshiko',
    headline: 'A good first search',
    intro: 'You have not run a search yet, so here is the shortest path to seeing what it is for.',
    tips: [
      {
        title: 'Search a word you half-know.',
        body: 'Nadeshiko finds it in real anime and drama lines, so you hear how it is actually used rather than how a dictionary says it is.',
      },
      {
        title: 'Search in English or Spanish too.',
        body: 'You do not need the Japanese word to find the Japanese sentence.',
      },
      {
        title: 'Play the clip.',
        body: 'Every result carries its own audio and its scene, which is the part a wordlist cannot give you.',
      },
    ],
    ctaLabel: 'Try a search',
    ctaPath: '/search',
  },
  anki: {
    subject: 'Send Nadeshiko sentences straight to Anki',
    headline: 'The part most people find last',
    intro:
      'You have been searching, which is the hard half. The other half is keeping what you find, and Nadeshiko will do that for you.',
    tips: [
      {
        title: 'Export to Anki in one click.',
        body: 'The sentence, its audio, its screenshot and the definition all go across together, already on the card.',
      },
      {
        title: 'Point it at your own deck.',
        body: 'Set the deck, note type and fields once in settings and every later export follows them.',
      },
      {
        title: 'Save first, sort later.',
        body: 'Collections hold anything you want to come back to without deciding about it now.',
      },
    ],
    ctaLabel: 'Set up Anki export',
    ctaPath: '/user/settings',
  },
  /**
   * For a reader who saved a profile and has never exported once.
   *
   * Every tip is a thing to CHECK, not a feature to discover, because this
   * reader has already decided they want the feature -- what they are missing is
   * that AnkiConnect refused them, on their own machine, in a way the site could
   * not previously name. Ordered by how often each one is the answer.
   */
  'anki-stalled': {
    subject: 'Your Anki export is one setting away',
    headline: 'Set up, but nothing has landed yet',
    intro:
      'You saved an Anki profile and no card has gone across since. That is almost always one of three things, and none of them are your deck.',
    tips: [
      {
        title: 'Anki has to be open, on the same machine.',
        body: 'AnkiConnect runs inside Anki itself, so the export reaches nothing while Anki is closed -- including on a phone.',
      },
      {
        title: 'It may be waiting for you to say yes.',
        body: 'The first time a site connects, AnkiConnect opens a dialog asking permission, and it can sit behind your browser window unnoticed. Bring Anki to the front and look for it.',
      },
      {
        title: 'Add us to webCorsOriginList.',
        body: "In Anki, under Tools, Add-ons, AnkiConnect, Config, make sure 'https://nadeshiko.co' is in webCorsOriginList, then restart Anki.",
      },
    ],
    ctaLabel: 'Test the connection',
    ctaPath: '/user/sync',
  },
  'going-further': {
    subject: 'Three things Nadeshiko does that you might have missed',
    headline: 'Three things worth knowing',
    intro: 'You have found your way around. These are the parts readers usually discover months in.',
    /*
     * CHOSEN FROM WHAT SIGNED-IN READERS ACTUALLY OPEN, over the 30 days to
     * 2026-08-20, rather than from what we would like them to. The three tips
     * here before were collections, the media filter and Shirabe, and they were
     * the three least-used things on the site: 1 reader created a collection in
     * that window, 5 changed media visibility, and Shirabe has 3 connections in
     * its entire history with none in 90 days. An email that lands once and
     * spends all three slots on features nobody takes up is a wasted send.
     *
     * These three are each used by enough readers to be proven worth having and
     * missed by enough to be worth telling: the word card (192), context (337)
     * and sharing (137).
     */
    tips: [
      {
        title: 'Click any word in a line.',
        body: 'The word card gives you its readings and definitions without leaving the result, and can add that single word to Anki on its own.',
      },
      {
        title: 'Open the context around a line.',
        body: 'Every result can expand into the lines before and after it, so a sentence that makes no sense alone usually makes sense in its scene.',
      },
      {
        title: 'Share a line as a link.',
        body: 'Any segment becomes a URL that plays the clip for whoever you send it to, with no account needed on their end.',
      },
    ],
    ctaLabel: 'Open Nadeshiko',
    ctaPath: '/',
  },
};

/**
 * Every link in a lifecycle email is tagged, so a visit that started in the
 * inbox is attributable in PostHog -- which auto-captures `utm_*` on pageview,
 * so there is nothing to add on the frontend.
 *
 * NEVER APPLIED TO THE UNSUBSCRIBE LINK. That click is somebody leaving; filing
 * it as campaign traffic would count an opt-out as engagement and flatter
 * exactly the send that earned it.
 */
export function withCampaignTags(path: string, campaign: string, content: string): string {
  const url = new URL(path, config.BASE_URL);
  url.searchParams.set('utm_source', 'nadeshiko');
  url.searchParams.set('utm_medium', 'email');
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  return url.toString();
}

export async function buildOnboardingDay7Email(input: {
  username: string;
  signals: OnboardingSignals;
  unsubscribeUrl: string;
}): Promise<{ subject: string; html: string; variant: OnboardingVariant }> {
  const variant = pickOnboardingVariant(input.signals);
  const copy = ONBOARDING_COPY[variant];

  const html = await renderTemplate('onboarding-day7', {
    headline: copy.headline,
    intro: copy.intro,
    tipOneTitle: copy.tips[0].title,
    tipOneBody: copy.tips[0].body,
    tipTwoTitle: copy.tips[1].title,
    tipTwoBody: copy.tips[1].body,
    tipThreeTitle: copy.tips[2].title,
    tipThreeBody: copy.tips[2].body,
    ctaLabel: copy.ctaLabel,
    ctaUrl: withCampaignTags(copy.ctaPath, `onboarding-day7-${variant}`, 'cta'),
    unsubscribeUrl: input.unsubscribeUrl,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject: copy.subject, html, variant };
}

export async function buildFeedbackAskEmail(input: {
  username: string;
  unsubscribeUrl: string;
}): Promise<{ subject: string; html: string }> {
  const html = await renderTemplate('feedback-ask', {
    username: input.username,
    ctaUrl: withCampaignTags('/', 'feedback-ask', 'cta'),
    unsubscribeUrl: input.unsubscribeUrl,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject: 'How is Nadeshiko working out?', html };
}

export async function renderTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  const templatePath = path.join(import.meta.dirname, 'templates', `${templateName}.html`);

  let html = await fs.promises.readFile(templatePath, 'utf-8');

  // OPTIONAL SECTIONS, `{{#name}}...{{/name}}`, kept when `name` has a value and
  // removed whole when it does not.
  //
  // Needed because every value here is HTML-escaped, so a chunk of markup cannot
  // be passed in as one -- it would render as visible tags. Without sections the
  // only way to make part of a message conditional is a second copy of the whole
  // template, and two copies of a sign-in email is how one of them quietly stops
  // matching the other.
  for (const [key, value] of Object.entries(variables)) {
    const section = new RegExp(`\\s*{{#${key}}}([\\s\\S]*?){{/${key}}}`, 'g');
    html = html.replace(section, value ? '$1' : '');
  }

  // Any section whose variable was not supplied at all. Left in place these
  // would ship as literal `{{#code}}` text in the message.
  html = html.replace(/\s*{{#\w+}}[\s\S]*?{{\/\w+}}/g, '');

  for (const [key, value] of Object.entries(variables)) {
    html = html.replaceAll(`{{${key}}}`, escapeHTML(String(value)));
  }

  return html;
}

function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}
