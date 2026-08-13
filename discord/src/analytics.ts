import { createHash } from 'node:crypto';
import { PostHog } from 'posthog-node';
import { createLogger } from './logger';
import { getMeter } from './telemetry';

/**
 * Two sinks, deliberately, because they answer different questions and neither
 * can answer the other's.
 *
 * OTel metrics -> VictoriaMetrics -> Grafana: is the bot healthy. Rate, errors,
 *   latency, Discord API pushback. Cheap, alertable, and every label here is
 *   BOUNDED -- see the note on cardinality below.
 * PostHog: is the bot USED, and by whom. Unique people, servers, funnels,
 *   retention. None of that is expressible as a Prometheus label without
 *   putting a Discord snowflake in one, which is how you turn a time-series
 *   database into a landfill.
 *
 * CARDINALITY IS THE WHOLE DESIGN CONSTRAINT ON THE METRICS SIDE. A user ID or
 * a guild ID as a metric attribute creates one series per user per metric,
 * forever, and VictoriaMetrics is shared with lostcoords. So identifiers go to
 * PostHog and only to PostHog. Everything recorded as a metric attribute below
 * comes from a fixed set the code itself defines: command names, custom IDs,
 * a status enum. If you add an attribute, ask what its maximum distinct count
 * is; if the answer involves a user, it belongs in `properties`, not `attrs`.
 */

const log = createLogger('analytics');

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const meter = getMeter();

/**
 * Replaces the old `discord.command.duration`, which only ever saw slash
 * commands -- roughly one interaction in twenty on this bot, since every button
 * and select menu is handled inside a message-component collector that the
 * command tracer never wrapped. Nothing consumed the old name (no dashboard, no
 * vmalert rule referenced it), so this is a clean rename rather than a break.
 */
const interactionDuration = meter.createHistogram('discord.interaction.duration', {
  description: 'Duration of a handled Discord interaction',
  unit: 's',
});

const interactionErrors = meter.createCounter('discord.interaction.errors', {
  description: 'Discord interactions that threw',
});

/**
 * Outcome, not just volume. "Nobody uses the bot" and "everybody uses the bot
 * and gets nothing back" produce the same command count and want completely
 * different fixes, so the empty-result case is a first-class label.
 */
const searches = meter.createCounter('discord.searches', {
  description: 'Searches run through the bot, by mode and outcome',
});

/**
 * The denominator for click-through. Every frontend URL the bot hands out is
 * counted here; PostHog counts the arrivals on the other side via
 * `utm_source=discord`. Neither number means much alone -- the ratio is the
 * point, and it is the only reason this counter exists.
 */
const linksEmitted = meter.createCounter('discord.links.emitted', {
  description: 'Links to the Nadeshiko frontend handed out by the bot',
});

const rateLimited = meter.createCounter('discord.rate_limited', {
  description: 'Times Discord rate-limited the bot',
});

export type GuildInfo = {
  id: string;
  name: string;
  memberCount: number;
};

let readGuilds: (() => GuildInfo[]) | undefined;

/**
 * Above this many servers, the per-guild identity series below stop being
 * emitted and only the aggregate count survives.
 *
 * The cap is not about today -- the bot is in a handful of servers and 250
 * series is nothing. It is about the version of this bot that gets listed in a
 * bot directory and lands in four thousand servers over a weekend, at which
 * point `discord_guild_info` becomes four thousand permanent series carrying
 * names in a store shared with lostcoords. Growth like that is a good problem,
 * and the cap means it stays a good problem instead of also being an incident.
 * Past it, use PostHog: it holds the same identity as group properties and is
 * built for that cardinality.
 */
const GUILD_SERIES_CAP = 250;

/**
 * Observable gauges rather than counters incremented on guildCreate: the bot
 * restarts, and a counter would restart with it. The client's cache is the
 * truth, so read it at collection time.
 */
meter
  .createObservableGauge('discord.guilds', {
    description: 'Servers the bot is currently in',
  })
  .addCallback((result) => {
    const guilds = readGuilds?.();
    if (guilds) result.observe(guilds.length);
  });

/**
 * The classic info-metric shape: the value is always 1 and the labels carry the
 * payload, so you join it onto a usage counter with
 * `* on(guild_id) group_left(guild_name)` to get names next to numbers.
 *
 * Guild IDs and names are NOT hashed, unlike user IDs, and the distinction is
 * deliberate rather than an oversight -- see the note above `pseudonymize`.
 */
meter
  .createObservableGauge('discord.guild.info', {
    description: 'One series per server, carrying its name and size',
  })
  .addCallback((result) => {
    const guilds = readGuilds?.();
    if (!guilds || guilds.length > GUILD_SERIES_CAP) return;

    for (const guild of guilds) {
      result.observe(1, {
        guild_id: guild.id,
        // Server names are user-chosen and can contain anything. Truncated
        // because a label is not a text field, and a 500-character server name
        // would otherwise be carried on every scrape forever.
        guild_name: guild.name.slice(0, 100),
      });
    }
  });

meter
  .createObservableGauge('discord.guild.members', {
    description: 'Approximate member count per server',
  })
  .addCallback((result) => {
    const guilds = readGuilds?.();
    if (!guilds || guilds.length > GUILD_SERIES_CAP) return;

    for (const guild of guilds) {
      result.observe(guild.memberCount, { guild_id: guild.id });
    }
  });

/**
 * Per-guild usage, kept as its own counter rather than a `guild_id` label on
 * `discord.interaction.duration`.
 *
 * That would have been one line less code and multiplicative cardinality:
 * ~35 interaction names x every server, growing with both. This grows with
 * servers alone, and the detailed per-interaction breakdown stays cheap.
 */
const guildInteractions = meter.createCounter('discord.guild.interactions', {
  description: 'Interactions handled, by server',
});

/** Lets `bot.ts` hand over the client's guild cache without this module importing discord.js. */
export function bindGuilds(fn: () => GuildInfo[]): void {
  readGuilds = fn;
}

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

const posthogKey = process.env.POSTHOG_PROJECT_API_KEY;
const analyticsSalt = process.env.DISCORD_ANALYTICS_SALT;

/**
 * Both or neither, and the salt is not optional.
 *
 * Discord snowflakes are stable, public, and trivially linkable back to a named
 * person, so sending raw ones to a third party is a decision nobody made on
 * purpose. Hashing without a secret salt is barely better -- the ID space is
 * enumerable enough that a hash of a known user ID is a lookup, not a
 * disguise. So an unsalted deployment gets no PostHog at all rather than
 * quietly getting the unsafe version, which is the failure mode that actually
 * happens when the safe path is the one requiring extra configuration.
 */
const posthog =
  posthogKey && analyticsSalt
    ? new PostHog(posthogKey, {
        host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
        // The bot is idle for long stretches. Left at the default flushAt of 20
        // a quiet server's events would sit in memory until a restart dropped
        // them, so flush on a timer instead and keep the batch small.
        flushAt: 5,
        flushInterval: 10_000,
        // No IP is attached to a gateway event in the first place; asking
        // PostHog to geolocate the bot's own egress would invent a location for
        // every user and put them all in the same datacentre.
        disableGeoip: true,
      })
    : undefined;

if (posthogKey && !analyticsSalt) {
  log.warn('POSTHOG_PROJECT_API_KEY is set but DISCORD_ANALYTICS_SALT is not -- product analytics stay disabled');
}

/**
 * Stable per user, useless to anyone who does not hold the salt, and not
 * reversible even with it -- you can confirm a suspected ID by hashing it, but
 * you cannot enumerate. That is the right trade for support ("is this person
 * hitting the error?") without carrying an identity graph.
 *
 * USERS ARE HASHED, SERVERS ARE NOT, and the asymmetry is the point.
 *
 * A server is a venue, not a person. Its ID and name carry none of the weight a
 * user ID does -- no GDPR personal-data question, nothing in Discord's
 * developer policy about transferring it, no risk of turning an analytics
 * store into a list of named individuals. And it is the more useful half:
 * "which communities actually use this" is a question you would act on, where
 * "which individual pressed next_page" mostly is not.
 *
 * Hashing users costs almost nothing in return. The support path still works --
 * hash a known ID and search for it -- so the only thing given up is browsing a
 * list and seeing who everyone is, which is precisely the capability that
 * carries the legal and policy weight.
 */
function pseudonymize(id: string): string {
  return createHash('sha256').update(`${analyticsSalt}:${id}`).digest('hex').slice(0, 32);
}

export type Actor = {
  userId: string;
  guildId: string | null;
};

/**
 * Never takes a raw query, a message, or a username. Call sites pass shape --
 * `query_length`, `result_count` -- because the questions worth asking are
 * about distributions, and the moment a search string lands in PostHog this
 * becomes a system holding user content.
 */
function capture(actor: Actor, event: string, properties: Record<string, unknown> = {}): void {
  if (!posthog) return;

  try {
    posthog.capture({
      distinctId: pseudonymize(actor.userId),
      event,
      properties: {
        ...properties,
        // Not the guild ID: `in_dm` is the only thing about the location that
        // is both useful and non-identifying at the property level. The guild
        // itself travels as a group, below.
        in_dm: actor.guildId === null,
        $process_person_profile: true,
      },
      // Group analytics is what makes "how many servers" answerable at all.
      // The raw ID, so it joins to the name set by `identifyGuild` and you can
      // read the roster in PostHog as server names rather than hashes.
      groups: actor.guildId ? { guild: actor.guildId } : undefined,
    });
  } catch (error) {
    // Analytics must never take a user interaction down with it.
    log.warn({ err: error, event }, 'Failed to capture analytics event');
  }
}

// ---------------------------------------------------------------------------
// The events themselves
// ---------------------------------------------------------------------------

export type InteractionKind = 'command' | 'component' | 'modal' | 'autocomplete' | 'message';

/**
 * Recorded for every handled interaction, from both sinks at once, so the
 * Grafana and PostHog views can never disagree about what happened.
 */
export function recordInteraction(params: {
  kind: InteractionKind;
  name: string;
  surface: string;
  actor: Actor;
  durationSeconds: number;
  error?: unknown;
}): void {
  const { kind, name, surface, actor, durationSeconds, error } = params;
  const status = error ? 'error' : 'ok';

  interactionDuration.record(durationSeconds, { kind, name, surface, status });

  if (actor.guildId) {
    guildInteractions.add(1, { guild_id: actor.guildId, status });
  }

  if (error) {
    interactionErrors.add(1, { kind, name, surface, error_type: errorType(error) });
  }

  capture(actor, 'bot_interaction', {
    kind,
    name,
    surface,
    status,
    duration_ms: Math.round(durationSeconds * 1000),
    ...(error ? { error_type: errorType(error) } : {}),
  });
}

export function recordSearch(params: {
  actor: Actor;
  mode: 'query' | 'random';
  resultCount: number;
  queryLength: number;
  exact?: boolean;
  category?: string;
  mediaFiltered: boolean;
  source: string;
}): void {
  const { actor, mode, resultCount, queryLength, exact, category, mediaFiltered, source } = params;
  const outcome = resultCount > 0 ? 'results' : 'empty';

  searches.add(1, { mode, outcome });

  capture(actor, resultCount > 0 ? 'bot_search_performed' : 'bot_search_empty', {
    mode,
    // Length rather than the query. See the note on `capture`.
    query_length: queryLength,
    result_count: resultCount,
    exact: exact ?? false,
    category: category ?? 'any',
    media_filtered: mediaFiltered,
    source,
  });
}

/**
 * `target` is the kind of page, not the URL -- a segment public ID in a metric
 * attribute would be unbounded.
 *
 * Metrics only, and deliberately so. Links are built deep inside embed
 * rendering, where there is no interaction and therefore no user to attribute
 * to; threading one down purely to satisfy PostHog would mean changing every
 * embed signature to record something the other half of the funnel already
 * covers. The arrivals are counted on the web side by `utm_source=discord`, so
 * what is missing here is only the denominator -- and a denominator does not
 * need to know who it was for.
 */
export function recordLinkEmitted(params: { target: string; surface: string }): void {
  linksEmitted.add(1, { target: params.target, surface: params.surface });
}

export function recordRateLimit(global: boolean): void {
  rateLimited.add(1, { global: String(global) });
}

export function recordGuildChange(kind: 'joined' | 'removed', guild: GuildInfo): void {
  // Guild lifecycle has no user behind it, so the guild stands in as the actor.
  capture({ userId: guild.id, guildId: guild.id }, `bot_guild_${kind}`, {
    guild_name: guild.name,
    member_count: guild.memberCount,
  });
}

/**
 * Attaches the server's name and size to its PostHog group, which is what turns
 * the group breakdown from a column of snowflakes into a readable list of who
 * installed the bot.
 *
 * Called for every guild on startup, not only on join: the bot was already in
 * servers before this code existed, and a group that is only ever named at
 * join time would leave all of them permanently anonymous.
 */
export function identifyGuild(guild: GuildInfo): void {
  if (!posthog) return;

  try {
    posthog.groupIdentify({
      groupType: 'guild',
      groupKey: guild.id,
      properties: {
        name: guild.name,
        member_count: guild.memberCount,
      },
    });
  } catch (error) {
    log.warn({ err: error, guildId: guild.id }, 'Failed to identify guild');
  }
}

function errorType(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : `Non-Error thrown: ${JSON.stringify(value)}`);
}

/**
 * A throw, sent to PostHog error tracking rather than only to the log.
 *
 * `recordInteraction` already counts that a command errored, which answers "how
 * often" -- it does not carry the stack, so it cannot answer "at what". The log
 * line has the stack but no grouping, no status and no first/last-seen, so a
 * command that has been failing for a week reads exactly like one that started
 * failing this morning.
 *
 * `source` is a stable identifier for the failing operation
 * (`discord:command-failed`) and becomes the grouping key, matching the
 * frontend's `reportError` convention. Keep it greppable and never interpolate
 * variable data into it -- that is what the properties are for.
 */
export function reportException(
  error: unknown,
  source: string,
  options: { actor?: Actor; properties?: Record<string, unknown> } = {},
): void {
  if (!posthog) return;

  const { actor, properties = {} } = options;

  try {
    posthog.captureException(error, actor ? pseudonymize(actor.userId) : 'discord-bot', {
      $exception_fingerprint: source,
      $exception_level: 'error',
      // Same asymmetry as `capture`: a hashed user is a person worth resolving
      // a report against, the bot process itself is not.
      ...(actor
        ? { $process_person_profile: true, in_dm: actor.guildId === null }
        : { $process_person_profile: false }),
      error_source: source,
      error_type: errorType(error),
      service: 'nadeshiko-discord',
      ...properties,
    });
  } catch (captureError) {
    // Reporting a failure must never become a second failure.
    log.warn({ err: captureError, source }, 'Failed to report an exception to PostHog');
  }
}

/**
 * The bot is dying. Report the cause, then flush -- in that order, and
 * awaited, because the default `unhandledRejection` behaviour on Node 20+ is to
 * terminate, and an un-flushed batch takes the explanation down with it.
 */
export async function reportFatal(error: unknown, source: string): Promise<void> {
  reportException(toError(error), source, { properties: { fatal: true } });
  await shutdownAnalytics();
}

export async function shutdownAnalytics(): Promise<void> {
  // Without this the last batch dies with the process on every deploy, which is
  // exactly when you most want to see what the bot was doing.
  await posthog?.shutdown(5000).catch((error: unknown) => {
    log.warn({ err: error }, 'PostHog shutdown failed');
  });
}
