/**
 * Who made this request: a reader, a robot, or one of our own probes.
 *
 * This is a *measurement* concern, not a policy one. Nothing here blocks
 * anybody: crawlers are how readers find the corpus, and the AI crawlers are
 * welcome too. What the labels buy is the ability to ask "is search slow, or is
 * a crawler enumerating it?" and "is this error burst hitting people, or only
 * GPTBot?" — questions a blended p95 and a blended error count cannot answer.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MIRRORED IN frontend/shared/utils/traffic.ts.                            │
 * │                                                                          │
 * │ Both runtimes have to give the same answer — the frontend classifies the │
 * │ visitor at the edge and this service has to agree for the requests SSR   │
 * │ proxies inward — but they are separate builds, so the block between the  │
 * │ MIRRORED markers below is kept identical by hand. Edit one, copy it to   │
 * │ the other; frontend/shared/utils/traffic.sync.test.ts fails the build if │
 * │ they drift.                                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// --- BEGIN MIRRORED BLOCK (keep byte-identical across both copies) ---

/** Three values, deliberately: this rides on metrics as an attribute, and every
 *  extra value multiplies every series it lands on. The crawler's *name* goes
 *  on a counter of its own and into log lines, where breadth is cheap. */
export type TrafficKind = 'reader' | 'bot' | 'monitor';

/**
 * Crawler families worth naming, grouped by what they are for. Longer variants
 * come first within a group: alternation is leftmost-first, so
 * `applebot-extended` has to precede `applebot` or it would be reported as
 * plain Applebot.
 *
 * Note what is NOT here: a bare `yandex`. The Yandex Search mobile app sends
 * `YandexSearch/...` and is a person, so only the named robots are matched.
 * The same care keeps a bare `bot` out of this list and in GENERIC_SOURCES,
 * where word boundaries do the work ("CUBOT_NOTE" is an Android phone).
 */
const FAMILY_SOURCES = [
  // Search engines. These send readers, which is why nothing here is throttled.
  'googlebot',
  'google-inspectiontool',
  'google-extended',
  'storebot-google',
  'feedfetcher-google',
  'applebot-extended',
  'applebot',
  'bingbot',
  'bingpreview',
  'duckassistbot',
  'duckduckbot',
  'yandex(?:bot|images|mobilebot|accessibilitybot)',
  'baiduspider',
  'petalbot',
  'seznambot',
  'qwantbot',

  // AI crawlers and assistant fetchers. The fastest-growing slice, and the
  // reason this file exists: they crawl at enumeration pace, and a page they
  // hammer looks exactly like a page that got slow.
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'claudebot',
  'claude-searchbot',
  'claude-user',
  'claude-web',
  'anthropic-ai',
  'perplexitybot',
  'perplexity-user',
  'meta-externalagent',
  'meta-externalfetcher',
  'bytespider',
  'tiktokspider',
  'amazonbot',
  'ccbot',
  'cohere-ai',
  'mistralai-user',
  'diffbot',
  'youbot',
  'timpibot',
  'imagesiftbot',
  'omgili(?:bot)?',
  'firecrawl',
  'ai2bot',
  'webzio-extended',

  // SEO and market-intelligence crawlers. Nothing they fetch benefits us.
  'semrushbot',
  'ahrefsbot',
  'ahrefssiteaudit',
  'dataforseobot',
  'mj12bot',
  'dotbot',
  'blexbot',
  'barkrowler',
  'serpstatbot',
  'screaming\\sfrog',

  // Link-preview fetchers. Worth naming separately because they are a signal,
  // not noise: discordbot spikes are our own Discord bot's embeds being opened.
  'facebookexternalhit',
  'twitterbot',
  'slackbot',
  'discordbot',
  'telegrambot',
  'whatsapp',
  'linkedinbot',
  'pinterestbot',
  'redditbot',
  'bluesky\\scardyb',
  'mastodon',
  'skypeuripreview',

  // Archives.
  'ia_archiver',
  'archive\\.org_bot',
  'internetarchive',
];

export const BOT_FAMILIES = new RegExp(`(${FAMILY_SOURCES.join('|')})`, 'i');

/**
 * Everything else that admits to being automated. Not enumerated, because the
 * long tail turns over weekly and none of it is worth a name: it all answers
 * `other`.
 *
 * The HTTP-library agents are here on purpose — a bare `python-requests` on the
 * public corpus is a scraper, and the SDK users we actually want to see are
 * identified by their API key, not by their User-Agent.
 */
const GENERIC_SOURCES = [
  '\\bbot\\b',
  'bot/',
  'crawler',
  'crawling',
  'spider',
  'scraper',
  'scrapy',
  'feedfetcher',
  'headlesschrome',
  'python-requests',
  'aiohttp',
  'httpx',
  'curl/',
  'wget/',
  'go-http-client',
  'okhttp',
  'axios/',
  'node-fetch',
  'libwww-perl',
  'java/',
  'apache-httpclient',
];

export const GENERIC_BOT = new RegExp(GENERIC_SOURCES.join('|'), 'i');

/**
 * Us, watching ourselves. Checked first, because a probe names a tool rather
 * than a robot and nothing above would catch it.
 *
 * These are the most dangerous kind of wrong number: they arrive on a fixed
 * cadence, forever, against the same few paths, so folding them into "reader"
 * makes reader latency partly a measurement of our own uptime checks. The
 * container health probes never reach here — instrumentation drops `/up`
 * outright — but anything checking a real page does.
 */
const MONITOR_SOURCES = [
  'nadeshiko-monitor',
  'kamal-proxy',
  'gatus',
  'uptime-kuma',
  'uptimerobot',
  'pingdom',
  'updown\\.io',
  'betteruptime',
  'better-uptime',
  'checkly',
  'statuscake',
  'hetrixtools',
  'site24x7',
  'blackbox_exporter',
  'prometheus/',
  'vmagent',
];

export const MONITORS = new RegExp(MONITOR_SOURCES.join('|'), 'i');

/**
 * The crawler's family (`"googlebot"`), `"other"` for an unnamed robot, or null
 * for anything we do not read as a crawler. Monitors answer null: they are not
 * crawlers, and `classifyTraffic` is where they are accounted for.
 */
export function botFamily(userAgent: string | null | undefined): string | null {
  const agent = (userAgent ?? '').trim();
  if (!agent || MONITORS.test(agent)) return null;

  const match = BOT_FAMILIES.exec(agent);
  if (match?.[1]) return match[1].toLowerCase().replace(/\s+/g, '-');

  return GENERIC_BOT.test(agent) ? 'other' : null;
}

/**
 * `"reader"`, `"bot"` or `"monitor"`.
 *
 * A blank User-Agent answers `"reader"`. It is the least useful of the three,
 * but the alternative — calling it a bot — would mislabel our own
 * server-to-server calls whenever the propagated traffic header is missing, and
 * a wrong "bot" is worse than a vague "reader": it hides load rather than
 * merely failing to attribute it.
 */
export function classifyTraffic(userAgent: string | null | undefined): TrafficKind {
  const agent = (userAgent ?? '').trim();
  if (agent && MONITORS.test(agent)) return 'monitor';
  return botFamily(agent) ? 'bot' : 'reader';
}

export function isBot(userAgent: string | null | undefined): boolean {
  return botFamily(userAgent) !== null;
}

/**
 * How the frontend tells the backend who it is rendering for.
 *
 * The backend can classify a forwarded User-Agent by itself, but the calls SSR
 * makes to fetch a page's data do not carry the visitor's User-Agent at all —
 * without these headers, a crawl of /search shows up as backend and
 * Elasticsearch load with no crawler attached to it. The backend only trusts
 * them from callers that prove they are us, exactly like the rate limiter's
 * exemption.
 */
export const TRAFFIC_HEADER = 'x-nadeshiko-traffic';
export const BOT_FAMILY_HEADER = 'x-nadeshiko-bot-family';

/** Parses a propagated header value back into a TrafficKind, or null if it is
 *  absent or not one of the three known values. */
export function parseTrafficHeader(value: string | null | undefined): TrafficKind | null {
  if (value === 'reader' || value === 'bot' || value === 'monitor') return value;
  return null;
}

/** Attribute keys, so every emitter spells them the same way. */
export const TRAFFIC_ATTRIBUTE = 'traffic';
export const BOT_FAMILY_ATTRIBUTE = 'bot.family';

/** The attribute bag to hang on a metric, span or log line. `bot.family` is
 *  omitted rather than set to null when there is no crawler, so reader traffic
 *  stays a single series. */
export function trafficAttributes(traffic: TrafficKind, family?: string | null): Record<string, string> {
  const attributes: Record<string, string> = { [TRAFFIC_ATTRIBUTE]: traffic };
  if (family) attributes[BOT_FAMILY_ATTRIBUTE] = family;
  return attributes;
}

// --- END MIRRORED BLOCK ---
