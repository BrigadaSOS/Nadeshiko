# Bot telemetry

What the bot reports, where each signal goes, and why it is split across two
systems. The infra-side counterpart — dashboards, alert rules, how the metrics
are stored — is in
[`brigadasos-infra/machines/nadeshiko/monitoring/README.md`](../../brigadasos-infra/machines/nadeshiko/monitoring/README.md).

## The problem this replaced

Until 2026-08-14 the bot emitted two metrics, `discord.command.duration` and
`discord.command.errors`, and recorded both only for slash commands. Everything
else a user does here — every button press, select menu and modal submission —
is handled inside a `createMessageComponentCollector` callback, and nothing
wrapped those. On a bot where one `/search` is followed by a dozen button
presses, roughly one interaction in twenty was counted.

The result, measured against production VictoriaMetrics on 2026-08-14: **one
recorded interaction in thirty days**, and `discord.command.errors` had never
incremented, so it did not exist as a series at all. That is not a usage
measurement. Read it as one and you would conclude the bot should be retired.

A second, quieter consequence: a throw inside a collector handler had no
`catch` anywhere above it. It surfaced as an unhandled promise rejection —
logged nothing, killed nothing, and left the user looking at a button that did
not respond.

## Two sinks, different questions

| | VictoriaMetrics → Grafana | PostHog |
| --- | --- | --- |
| Answers | is the bot healthy | is the bot used, and by whom |
| Carries | rate, errors, latency, Discord API pushback | unique users, servers, funnels, retention |
| Identifiers | **never** | salted hashes |
| Alertable | yes, via vmalert | no |

The split is forced by cardinality. A Discord snowflake as a metric label is one
new series per user, forever, in a store shared with another project. So
identifiers go to PostHog and only to PostHog, and every metric attribute the
bot emits comes from a fixed set the code itself defines.

**If you add a metric attribute, ask what its maximum distinct count is.** If the
answer involves a user, it belongs in a PostHog property, not a metric label.

## Where the wrapping happens

`src/instrumentation.ts` exports four wrappers, and all of them funnel into one
`run()`:

- `traceCommand` — slash commands, from `bot.ts`
- `traceComponent` — **the load-bearing one.** Wraps a
  `collector.on('collect')` handler
- `traceModal` — modal submissions
- `traceOperation` — autocomplete, which has no custom ID to name it by

`traceComponent` is applied **at the collector, not at each branch inside it**.
`collector.on('collect')` is one call site per command while the branches it
dispatches to number in the dozens, and the custom ID is already on the
interaction — so wrapping the collector gets per-button granularity for free and
cannot go stale when someone adds a button.

Call sites: `commands/search.ts`, `commands/sentence.ts`, `commands/settings.ts`,
and the modal listener in `searchModal.ts`.

`traceComponent` and `traceModal` swallow errors after recording them. That is
the same user-visible outcome as before — these are async EventEmitter callbacks,
so nothing ever caught them — and a completely different debugging one.

## Metrics

| Metric | Attributes | Notes |
| --- | --- | --- |
| `discord.interaction.duration` | `kind`, `name`, `surface`, `status` | histogram, seconds. `kind` is command/component/modal/autocomplete/message |
| `discord.interaction.errors` | `kind`, `name`, `surface`, `error_type` | |
| `discord.searches` | `mode`, `outcome` | `outcome` is results/empty |
| `discord.links.emitted` | `target`, `surface` | click-through denominator |
| `discord.rate_limited` | `global` | |
| `discord.guilds` | — | observable gauge over the client's guild cache, so it survives restarts |
| `discord.guild.info` | `guild_id`, `guild_name` | constant 1; the labels are the payload |
| `discord.guild.members` | `guild_id` | approximate member count |
| `discord.guild.interactions` | `guild_id`, `status` | per-server usage |

### Servers are named, users are hashed

Guild IDs and names go out raw. A server is a venue, not a person: none of the
personal-data weight of a user ID, and *which communities use this* is the
question worth acting on. In Grafana, join `discord_guild_info` onto
`discord_guild_interactions_total` with
`* on (guild_id) group_left (guild_name)` to get a table of server names by
usage — the "Who is using the bot" panel does exactly that, and the panel beside
it lists installs with **zero** usage, which a usage counter alone cannot
produce.

Above 250 servers the per-guild series stop being emitted and only the aggregate
count survives. That is a guard against the bot landing in a directory, not a
statement about today.

`discord.guild.interactions` is its own counter rather than a `guild_id` label
on the duration histogram, which would have been multiplicative (~35 names ×
every server) instead of growing with servers alone.

`discord.command.duration` and `discord.command.errors` are gone. Nothing
consumed them, so nothing broke — but a query written before that date returns
empty rather than erroring.

## PostHog events

All prefixed `bot_`, in the **same project as the frontend** — the join between
"searched in Discord" and "arrived on nadeshiko.co" cannot happen across two
projects, and the prefix keeps them out of web analytics, which keys off
`$pageview`.

- `bot_interaction` — `kind`, `name`, `surface`, `status`, `duration_ms`
- `bot_search_performed` / `bot_search_empty` — `mode`, `query_length`,
  `result_count`, `exact`, `category`, `media_filtered`, `source`
- `bot_guild_joined` / `bot_guild_removed` — `guild_name`, `member_count`

Guilds are attached as a PostHog **group** keyed on the raw guild ID, and
`identifyGuild` sets `name` and `member_count` as group properties — so the
group breakdown reads as a list of server names rather than a column of
snowflakes. It runs for every guild on `ClientReady`, not only on join: the bot
was already in servers before any of this existed, and naming groups only at
join time would leave those permanently anonymous.

**No event carries a search query, a message, or a username.** Call sites pass
shape — `query_length`, `result_count` — because the questions worth asking are
about distributions, and the moment a query string lands in PostHog this becomes
a system holding user content.

### Configuration

| Variable | |
| --- | --- |
| `POSTHOG_PROJECT_API_KEY` | public project key, same as the frontend's |
| `POSTHOG_HOST` | `https://us.i.posthog.com` — direct, not the `t.nadeshiko.co` proxy, which exists to get past browser content blockers the bot does not face |
| `DISCORD_ANALYTICS_SALT` | secret, from SSM |

**Both the key and the salt, or no PostHog at all.** Hashing a snowflake without
a secret salt is barely better than sending it raw — the ID space is enumerable
enough that a hash of a known ID is a lookup, not a disguise. An unsalted
deployment gets product analytics disabled with a warning rather than quietly
getting the unsafe version, because the failure mode that actually happens is
the one where the safe path needs extra configuration.

## Link attribution

Discord strips the referrer, so a click from a bot embed arrives at nadeshiko.co
as `$direct`, indistinguishable from someone typing the URL. Every link the bot
hands out therefore carries its own provenance, stamped in `src/links.ts`:

```
utm_source=discord  utm_medium=bot  utm_campaign=<surface>  utm_content=<destination kind>
```

posthog-js reads these into `$pageview` with no frontend change.

**Attribution is on by default and must be opted out of.** The failure mode of
the reverse — a new link that quietly is not tracked — is invisible for months;
this one shows up as impossible traffic. `/health` is the only real opt-out, and
says so at its call site: it fetches those URLs itself, and tagged as user
traffic it would manufacture exactly the click-through the scheme measures.

Click-through rate is a ratio across the two systems:

```
PostHog sessions with utm_source=discord  ÷  sum(increase(discord_links_emitted_total[range]))
```

It is **not** a per-user funnel. The web visitor is anonymous and the Discord
user is a salted hash; there is no join key, by design.

## Testing

`src/test/mocks/api.ts` mocks `instrumentation` with pass-throughs, not no-ops —
the flow tests drive real button presses through the handlers `traceComponent`
now wraps, so a mock that dropped the handler would silently test nothing.
