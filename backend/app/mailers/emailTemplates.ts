import fs from 'fs';
import path from 'path';
import { config } from '@config/config';
import { loadCopy } from './copy';
import type { Sender } from './senders';
import type { CatalogueSize } from '@app/services/stats/catalogueSize';
import { returnUrl, withCampaignTags } from '@app/services/email/returnLink';

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

/** Every personal email carries the same three things about whoever wrote it. */
export function senderVariables(sender: Sender): Record<string, string> {
  return {
    senderName: sender.name,
    senderProfileUrl: sender.profileUrl,
    avatarUrl: `${config.BASE_URL}${sender.avatarPath}`,
  };
}

/** Keep the invite literal here because backend cannot import the frontend constant; the repository sync test keeps
 * both codes aligned. */
const DISCORD_INVITE_URL = 'https://discord.gg/qRak9MprUS';

interface WelcomeStep {
  /** A file under `frontend/public/email/`, or empty for a text-only section. */
  image: string;
  /** Describes the thing happening, for the reader whose client blocks images. */
  alt: string;
  /** The still links to the site: email video support is limited, and the click is the useful feature signal. */
  path: string;
  /** `utm_content`, so the four are separable in PostHog. */
  slug: string;
}

/** Keep assets and links here, prose in `copy/welcome.md`. Empty images are valid: sections must remain readable
 * when clients block assets. */
const WELCOME_STEPS: readonly [WelcomeStep, WelcomeStep, WelcomeStep, WelcomeStep] = [
  {
    image: 'search-ecdd60e0.jpg',
    alt: 'Searching for a word and the results filling in',
    path: '/search',
    slug: 'search',
  },
  {
    image: 'word-card-b33b017a.jpg',
    alt: 'Clicking a word to open its definition card',
    path: '/search',
    slug: 'word-card',
  },
  { image: 'player-0a312790.jpg', alt: 'Playing a clip and looping it in the player', path: '/search', slug: 'player' },
  { image: '', alt: '', path: '/user/settings', slug: 'anki' },
] as const;

/** Where the welcome email's demo assets live, when they exist. */
function stepImageUrl(file: string): string {
  return file ? `${config.BASE_URL}/email/${file}` : '';
}

export async function buildWelcomeEmail(
  username: string,
  sender: Sender,
  catalogue?: CatalogueSize | null,
): Promise<{
  subject: string;
  html: string;
}> {
  const subject = 'Welcome to Nadeshiko!';
  const [one, two, three, four] = WELCOME_STEPS;

  // Omit the row when count is unavailable; format present counts here because the template cannot add separators.
  const number = (value: number) => value.toLocaleString('en-US');

  const html = await renderTemplate('welcome', {
    ...(await loadCopy('welcome')),
    ...senderVariables(sender),
    username,
    baseUrl: config.BASE_URL,
    // One flag for the row, three pairs for the cards. Empty hides the lot.
    scale: catalogue ? 'yes' : '',
    scaleSentences: catalogue ? number(catalogue.sentences) : '',
    scaleTitles: catalogue ? number(catalogue.titles) : '',
    scaleHours: catalogue ? number(catalogue.hours) : '',
    discordUrl: DISCORD_INVITE_URL,
    discordIconUrl: `${config.BASE_URL}/email/discord-711a1bee.png`,
    stepOneImage: stepImageUrl(one.image),
    stepOneAlt: one.alt,
    stepOneUrl: withCampaignTags(one.path, 'welcome', one.slug),
    stepTwoImage: stepImageUrl(two.image),
    stepTwoAlt: two.alt,
    stepTwoUrl: withCampaignTags(two.path, 'welcome', two.slug),
    stepThreeImage: stepImageUrl(three.image),
    stepThreeAlt: three.alt,
    stepThreeUrl: withCampaignTags(three.path, 'welcome', three.slug),
    stepFourImage: stepImageUrl(four.image),
    stepFourAlt: four.alt,
    stepFourUrl: withCampaignTags(four.path, 'welcome', four.slug),
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

/** An absent login code is supported: the sign-in link still works and the code block is omitted. */
export async function buildMagicLinkEmail(
  url: string,
  code?: string | null,
): Promise<{ subject: string; html: string }> {
  const subject = 'Nadeshiko: Your sign-in link';
  const html = await renderTemplate('magic-link', {
    ...(await loadCopy('magic-link')),
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
    ...(await loadCopy('verify-new-email')),
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

/** Lead feedback notification subjects with sender and opening text so a mailbox list is triageable without opening
 * the message. */
export async function buildFeedbackEmail(input: FeedbackEmailInput): Promise<{ subject: string; html: string }> {
  const subject = `\u{1F4AC} Feedback from ${input.from}: ${truncate(collapseWhitespace(input.message), 60)}`;
  const html = await renderTemplate('feedback', {
    ...(await loadCopy('feedback')),
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

/** Re-export link tags from the redirect layer, where the final destination is known. */
export { withCampaignTags };

/** Use one day-7 email with warm/cold openings; keep the branch in `campaign`, not bounded `email.kind`, for
 * analytics. */
export async function buildFeedbackAskEmail(input: {
  username: string;
  sender: Sender;
  /** Whether they have ever run a search. See `hasStarted` in the lifecycle worker. */
  started: boolean;
  unsubscribeUrl: string;
}): Promise<{ subject: string; html: string; campaign: string }> {
  const campaign = input.started ? 'feedback-ask-started' : 'feedback-ask-cold';

  const html = await renderTemplate('feedback-ask', {
    ...(await loadCopy('feedback-ask')),
    ...senderVariables(input.sender),
    discordUrl: DISCORD_INVITE_URL,
    discordIconUrl: `${config.BASE_URL}/email/discord-711a1bee.png`,
    username: input.username,
    // Use conditional sections in one template so the two openings cannot drift as duplicate messages.
    started: input.started ? 'yes' : '',
    cold: input.started ? '' : 'yes',
    // Read only by the cold section, and dropped with it when they have started.
    ctaUrl: withCampaignTags('/search', campaign, 'cta'),
    unsubscribeUrl: input.unsubscribeUrl,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  const subject = input.started ? 'How is Nadeshiko working out?' : 'What were you hoping to find?';

  return { subject, html, campaign };
}

/** Show new titles when there are any; with zero, ask what went wrong and omit the button rather than advertise an
 * empty result. */
export interface DormantTitle {
  name: string;
  coverUrl: string;
  /** Pass a site path, not a finished URL: the return-link builder adds the recipient token once it knows the
   * account. */
  path: string;
}

/** A `DormantTitle` once it has a recipient, and therefore a real link. */
interface LinkedTitle {
  name: string;
  coverUrl: string;
  url: string;
}

/** How many covers the grid will show. Past this they stop being a sample and become a list. */
export const DORMANT_TITLE_SLOTS = 8;

/** The column the card gives its content, once padding is taken off the 640px card. */
const CONTENT_WIDTH = 576;

/** Covers come off the CDN at 460 wide; the height varies, so the tile fixes the shape. */
const COVER_RATIO = 647 / 460;

/** No tile is ever bigger than this, however few there are. One cover must not fill the email. */
const MAX_TILE = 180;

const TILE_GAP = 8;

/** Lay out up to four covers per row, then centered short final rows for readable grids. */
export function titleRows<T>(titles: readonly T[]): T[][] {
  const perRow = titles.length <= 4 ? titles.length : titles.length <= 6 ? 3 : 4;
  if (perRow === 0) return [];

  const rows: T[][] = [];
  for (let i = 0; i < titles.length; i += perRow) rows.push(titles.slice(i, i + perRow));
  return rows;
}

/** The grid returns raw generated HTML, so it must escape every title and keep tile dimensions consistent. */
export function renderTitleGrid(titles: readonly LinkedTitle[]): string {
  const rows = titleRows(titles.slice(0, DORMANT_TITLE_SLOTS));
  if (rows.length === 0) return '';

  const widest = Math.max(...rows.map((row) => row.length));
  const width = Math.min(MAX_TILE, Math.floor((CONTENT_WIDTH - (widest - 1) * TILE_GAP) / widest));
  const height = Math.round(width * COVER_RATIO);

  return rows
    .map((row) => {
      const cells = row
        .map((title) => {
          const name = escapeHTML(title.name);
          return `<td class="tile" style="padding: 0 ${TILE_GAP / 2}px ${TILE_GAP}px; vertical-align: top; width: ${width}px;">
                <a href="${escapeHTML(title.url)}" style="text-decoration: none; color: #a8a8a8;">
                  <img src="${escapeHTML(title.coverUrl)}" class="tile-img" alt="${name}" width="${width}" height="${height}" style="width: ${width}px; height: ${height}px; object-fit: cover; border-radius: 6px; display: block;" />
                  <span class="tile-name" style="display: block; font-size: 12px; line-height: 1.35; margin-top: 6px; color: #a8a8a8; width: ${width}px;">${name}</span>
                </a>
              </td>`;
        })
        .join('\n              ');

      return `<table role="presentation" align="center" class="tile-grid" style="border-collapse: collapse; margin: 0 auto;">
            <tr>
              ${cells}
            </tr>
          </table>`;
    })
    .join('\n          ');
}

export async function buildDormant30Email(input: {
  /** Require the recipient to build these links: each token attributes a click to an account rather than an
   * arbitrary `utm_*` value. */
  userId: number;
  /** Which run, sealed into every link so a click can be joined to the send. */
  campaign: string;
  username: string;
  sender: Sender;
  newTitles: number;
  /**
   * A few of them, to show rather than count. At most `DORMANT_TITLE_SLOTS`;
   * anything past that is dropped, since the template has fixed cells.
   */
  titles: DormantTitle[];
  unsubscribeUrl: string;
}): Promise<{ subject: string; html: string }> {
  // Let the count choose the grid shape but do not print it; a small or disputed count should not undermine the
  // message.
  const hasNews = input.newTitles > 0;
  // Avoid claims about a last visit: dormancy is account state, while “what is new” is true for every recipient.
  const subject = hasNews ? 'We have added new titles to Nadeshiko!' : 'Anything we could have done?';

  // Tag covers by position so click data can compare which placement performs best.
  const link = (path: string, content: string): string =>
    returnUrl({ userId: input.userId, kind: 'dormant-30', campaign: input.campaign, path, content });

  const titles: LinkedTitle[] = input.titles.map((title, index) => ({
    name: title.name,
    coverUrl: title.coverUrl,
    url: link(title.path, `title-${index + 1}`),
  }));

  const html = await renderTemplate('dormant-30', {
    ...(await loadCopy('dormant-30')),
    ...senderVariables(input.sender),
    discordUrl: DISCORD_INVITE_URL,
    discordIconUrl: `${config.BASE_URL}/email/discord-711a1bee.png`,
    username: input.username,
    // Empty rather than '0': `renderTemplate` keeps a section when the value is
    // truthy, and the string '0' is.
    newTitles: hasNews ? String(input.newTitles) : '',
    noNews: hasNews ? '' : 'yes',
    // The grid is generated rather than slotted, because its shape depends on
    // how many covers there are -- see `renderTitleGrid`. Raw on purpose, and it
    // escapes its own inputs.
    titleGrid: renderTitleGrid(titles),
    ctaUrl: link('/', 'cta'),
    unsubscribeUrl: input.unsubscribeUrl,
    logoUrl: getLogoUrl(),
    year: getCurrentYear(),
  });

  return { subject, html };
}

export async function renderTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  const templatePath = path.join(import.meta.dirname, 'templates', `${templateName}.html`);

  let html = await fs.promises.readFile(templatePath, 'utf-8');

  // Use conditional sections because values are HTML-escaped; passing markup as one value would display tags.
  for (const [key, value] of Object.entries(variables)) {
    const section = new RegExp(`\\s*{{#${key}}}([\\s\\S]*?){{/${key}}}`, 'g');
    html = html.replace(section, value ? '$1' : '');
  }

  // Any section whose variable was not supplied at all. Left in place these
  // would ship as literal `{{#code}}` text in the message.
  html = html.replace(/\s*{{#\w+}}[\s\S]*?{{\/\w+}}/g, '');

  // Triple braces are raw and reserved for module-generated, already-escaped markup; reader/database values must use
  // escaped interpolation.
  for (const [key, value] of Object.entries(variables)) {
    html = html.replaceAll(`{{{${key}}}}`, String(value));
  }

  for (const [key, value] of Object.entries(variables)) {
    html = html.replaceAll(`{{${key}}}`, escapeHTML(String(value)));
  }

  return html;
}

function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}
