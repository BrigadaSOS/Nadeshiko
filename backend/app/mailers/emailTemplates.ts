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

/**
 * What the welcome email shows, in the order a reader meets it.
 *
 * THE PROSE IS NOT HERE ANY MORE, and that is the point of this shape. Titles,
 * bodies and bullets are static English text that a person rewrites far more
 * often than anybody touches this file, and having them in a TypeScript string
 * literal meant every wording change was a code change, in a different file from
 * the markup it renders into, with no way to see the result. They live in
 * `templates/welcome.html` now, where they can be read in place and edited
 * against a live preview.
 *
 * What stays here is what the template genuinely cannot know: which asset each
 * section shows, where its still links to, and the `utm_content` that keeps the
 * four separable in PostHog.
 *
 * `image` IS ALLOWED TO BE EMPTY, and that is the design rather than a
 * placeholder state. Images are blocked by default in a good share of mail
 * clients, so each section has to read correctly with nothing but its heading
 * and its text -- and a section whose asset does not exist yet simply renders as
 * that. The Anki section is deliberately and permanently empty: it is a round
 * trip through Anki's own settings and a running copy of Anki on the reader's
 * machine, so any still that fits an email is a picture of a dialog rather than
 * of the feature.
 */
/**
 * The community invite, written out rather than imported: this is the backend
 * and the constant lives in `frontend/shared/utils/socialLinks.ts`, which it
 * cannot reach. That file's `socialLinks.sync.test.ts` walks the repo for every
 * `discord.gg/<code>` in a scanned extension -- `.html` included -- so this copy
 * and the template's are both held to the real code by that test. Rotate the
 * invite there and it will name this line.
 */
const DISCORD_INVITE_URL = 'https://discord.gg/qRak9MprUS';

interface WelcomeStep {
  /** A file under `frontend/public/email/`, or empty for a text-only section. */
  image: string;
  /** Describes the thing happening, for the reader whose client blocks images. */
  alt: string;
  /**
   * Where the still takes them, which is the whole reason it is a still.
   *
   * Inline `<video>` plays in Apple Mail and in almost nothing else, so a
   * fallback image has to exist either way -- and a clip that plays INSIDE the
   * email gives the reader no reason to leave it. A thumbnail that opens the
   * site does the thing this email is for, and the click is the only signal we
   * get about which feature anybody actually wants.
   */
  path: string;
  /** `utm_content`, so the four are separable in PostHog. */
  slug: string;
}

/**
 * What each welcome section SHOWS. What it says lives in `copy/welcome.md`.
 *
 * The split is deliberate: prose is the thing that gets rewritten, and it should
 * not be a code change in a different file from the words it sits next to. What
 * stays here is what Markdown cannot express -- which asset a section shows,
 * where its still links to, and the `utm_content` that keeps the four separable.
 *
 * `image` IS ALLOWED TO BE EMPTY, and that is the design rather than a
 * placeholder state. Images are blocked by default in a good share of mail
 * clients, so each section has to read correctly with nothing but its words. The
 * Anki section is permanently empty: it is a round trip through Anki's own
 * settings and a running copy of Anki on the reader's machine, so any still that
 * fits an email is a picture of a dialog rather than of the feature.
 */
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

  // Absent when the count failed or was not asked for, and the whole row
  // disappears with it -- see `catalogueSize` on why a missing number must not be
  // a missing email. Formatted here rather than in the template, which cannot do
  // thousands separators.
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

/**
 * Re-exported rather than defined here, because the tags are now applied at the
 * REDIRECT (`services/email/returnLink`) to the destination it hands back. The
 * address that goes in a dormant message is `EMAIL_LINK_PATH`; messages that
 * still link straight to the site keep tagging their own links with this.
 */
export { withCampaignTags };

/**
 * The day-7 ask, in the only two shapes a week-old account comes in.
 *
 * ONE EMAIL RATHER THAN TWO, because it is one email: you have been here a week,
 * tell me something. What changes is which question can be answered. A reader
 * who has searched has an opinion about the thing; a reader who has not has an
 * opinion about what they came for, which is the more useful half -- it is the
 * difference between what Nadeshiko is and what people expect it to be.
 *
 * THE COLD QUESTION IS DELIBERATELY NOT "WHY DIDN'T YOU?". An email that opens
 * by pointing out what somebody failed to do reads as an accusation and gets
 * answered by nobody. "What were you hoping to find" asks for the same
 * information and is answerable without admitting anything.
 *
 * ONLY THE COLD OPENING GETS A BUTTON, which is the one thing worth copying from
 * how other people write these. The action this email wants is a REPLY, and a
 * button competes with it: "Tell me" pointing at the home page gave a reader
 * somewhere to click that does nothing feedback-shaped, and every click on it
 * was a reply we did not get. The cold opening keeps its button because "try a
 * search" is a real action with a real destination.
 *
 * The branch rides out in the campaign rather than the kind, so the two are
 * separable in PostHog and in the click tags without adding a metric series --
 * see `sendEmail` on why `email.kind` has to stay bounded.
 */
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
    // Exactly one of these carries a value, and `renderTemplate` drops the
    // section belonging to the other. Two sections rather than two templates,
    // for the reason `renderTemplate` documents: a second copy of a message is
    // how one of them quietly stops matching the other.
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

/**
 * The win-back note, sent once the reader's last session has lapsed.
 *
 * `newTitles` IS THE WHOLE MESSAGE. "We miss you" is a sentence about us; a
 * count of what has been added since they were last here is a sentence about
 * them, and it is the only honest reason to think a second visit would go
 * differently from the first. It also has to be the lead rather than a question,
 * because this reader has already had a question -- the day-7 ask -- and did not
 * answer it. Asking again is the same email twice.
 *
 * ZERO IS A REAL ANSWER, and it gets its own shape rather than a dropped line.
 * A quiet month leaves this email with no argument at all, and "0 new titles" is
 * an argument for staying away; so when there is nothing to report it stops
 * pretending and asks what went wrong instead, which is the one thing still
 * worth getting from somebody on their way out. That shape has no button either:
 * "see what is new" over a month with nothing new is a link to a
 * disappointment, and the reply is the whole point of sending it at all.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY is that their data is safe. It is the
 * standard move in win-back mail -- "your profile and references are still
 * exactly where you left them" -- and it works for products where a lapsed
 * reader has years of accumulated state to lose. A lapsed Nadeshiko reader has
 * saved almost nothing (one collection was created across a whole month), so
 * reassuring them their collections survived reads as a reminder that they never
 * made one.
 */
export interface DormantTitle {
  name: string;
  coverUrl: string;
  /**
   * Where the cover goes, as a SITE PATH rather than a finished URL.
   *
   * The link a recipient actually gets is `EMAIL_LINK_PATH` carrying a token
   * that names them, and only `buildDormant30Email` knows who they are -- so the
   * sweep that finds these titles can no longer finish the address. It hands
   * over the destination and this file turns it into a link.
   */
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

/**
 * How the covers are laid out for a given count.
 *
 * One row up to four. Five and six read better as two rows of three than as a
 * row of four with a widow, and seven and eight as two rows of four. The last
 * row is centred when it is short, so a five ends as three over two rather than
 * three over two-hugging-the-left.
 */
export function titleRows<T>(titles: readonly T[]): T[][] {
  const perRow = titles.length <= 4 ? titles.length : titles.length <= 6 ? 3 : 4;
  if (perRow === 0) return [];

  const rows: T[][] = [];
  for (let i = 0; i < titles.length; i += perRow) rows.push(titles.slice(i, i + perRow));
  return rows;
}

/**
 * The cover grid, built here because its shape depends on the count.
 *
 * EVERY TILE IS THE SAME SIZE, including in a row that is not full: the widest
 * row decides, so a seven does not render four small covers above three large
 * ones. And the tile is capped at `MAX_TILE`, so a single cover is a cover
 * rather than a poster.
 *
 * Escapes its own inputs. It is returned through the raw `{{{ }}}` path, which
 * does no escaping of its own -- see `renderTemplate`.
 */
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
  /**
   * Who this copy is for. Every link in it is wrapped in a token naming them,
   * so the message can no longer be built without knowing the recipient -- see
   * `services/email/returnLink` for why the click has to be attributable to an
   * account rather than to a `utm_*` the browser may or may not carry back.
   */
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
  // THE COUNT STILL DECIDES THE SHAPE, IT JUST NO LONGER APPEARS.
  //
  // Ingest is bursty -- two titles in a quiet month, eighty in a busy quarter --
  // so the honest number is often small enough to argue against the email
  // carrying it, and a floor would have meant printing a figure a reader can
  // disprove from the home page in four seconds. The grid is topped up to a full
  // eight either way, so it does the pulling and the sentence stays true without
  // committing to a figure.
  const hasNews = input.newTitles > 0;
  const subject = hasNews ? 'We added new titles since you were last here!' : 'Anything we could have done?';

  // TAGGED BY POSITION, not just as "a cover". Untagged, a click on a title is
  // indistinguishable from any other visit and the one thing this email is
  // actually testing -- whether showing what is here beats saying how much was
  // added -- cannot be read off.
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

  // TRIPLE BRACE IS RAW, double brace is escaped. Mustache's convention, and it
  // exists here for exactly one thing: markup this module generates itself, such
  // as `renderTitleGrid`, whose shape depends on how many items there are and so
  // cannot be expressed as fixed slots in the template.
  //
  // NEVER PUT ANYTHING THAT CAME FROM A READER OR A DATABASE THROUGH IT. The
  // generator is responsible for escaping its own inputs -- `renderTitleGrid`
  // runs every title name through `escapeHTML` before it reaches here -- and a
  // second caller that forgets is an HTML injection into a message we send.
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
