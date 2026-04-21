---
title: "Nadeshiko v2.1.0 — DEV + Discord Update: SDKs, Bot, and API Stability"
description: "Official SDKs for Python and TypeScript, a Discord bot that turns sentence links into rich embeds, and a promise of zero breaking changes going forward."
date: 2026-04-20T00:00:00Z
image: /images/blog/nadeshiko-dev-2-1-0.jpg
draft: true
---

# Nadeshiko v2.1.0 — DEV Update

This release is for the developers, integrators, and power users who want to build on top of Nadeshiko. We are officially launching our SDKs, opening up more API endpoints, and making a long-term commitment to API stability.

## Official SDKs: Python and TypeScript

After weeks of refining the OpenAPI specification and developer experience, both SDKs are now available and production-ready.

### TypeScript — `npm add @brigadasos/nadeshiko-sdk`

```typescript
import { createNadeshikoClient } from '@brigadasos/nadeshiko-sdk';

const client = createNadeshikoClient({ apiKey: 'nade_xxx' });
const { segments } = await client.search({ query: { search: '彼女' } });

// Auto-pagination
for await (const seg of client.search.paginate({ query: { search: '猫' } })) {
  console.log(seg.textJa.content);
}
```

### Python — `pip install nadeshiko-sdk`

```python
from nadeshiko import Nadeshiko
from nadeshiko.api.search import search

client = Nadeshiko(token="nade_xxx")
result = search.sync(client, body=SearchRequest(query="食べる"))
```

**SDK highlights:**
- Full type safety generated from OpenAPI
- Automatic retries with exponential backoff and `Retry-After` header support
- RFC 7807 error handling with machine-readable codes and trace IDs
- Cursor-based pagination with `.paginate()` async iterators
- Per-call opt-out of exceptions via `throwOnError: false`

## Discord Bot: Auto-Embed Magic

Drop a Nadeshiko sentence link in Discord and the bot automatically replies with a rich embed containing:

- Japanese text with furigana
- English and Spanish translations
- Inline audio and video clips
- Context navigation buttons (previous and next segments)
- Links to filtered search results by media and episode

No commands needed. Just paste a link like `nadeshiko.co/sentence/xK9mP2nQwR4t` and the bot handles everything. Server admins can toggle auto-embeds per guild via settings.

## API Stability Promise

Here is the important part: **I personally reviewed every endpoint, parameter name, and response schema to ensure a consistent, intuitive developer experience. After this release, I am committing to zero breaking changes in the public API.**

New features and endpoints will be purely additive. The API is version-tagged and backwards-compatible. If you build on Nadeshiko today, your code will work tomorrow.

## New API Endpoints

More of Nadeshiko's core functionality is now accessible via API:

- **`searchWords`** — Look up multiple words simultaneously, get match counts per media
- **`searchMedia`** — Autocomplete media titles
- **`getSearchStats`** — Category counts and media lists for building filter UIs
- **`getStatsOverview`** — Corpus-wide statistics: segment count, media coverage tiers
- **Collections API** — Full CRUD for saved sentence collections
- **User Activity** — Personal activity tracking and heatmap visualization
- **`getSegmentContext`** — Fetch surrounding segments for context expansion

Additional endpoints are in development to expose the full depth of Nadeshiko's dataset.

## What Changed Since v2.0.0

**User-facing improvements:**

- **Stats dashboard** — Explore corpus-wide analytics including total segments, media coverage tiers, and search statistics
- **Persistent sessions** — Sessions now last 30 days instead of expiring when the browser closes
- **Rate limit increase** — Raised to 20,000 requests per month for all tiers
- **Search improvements** — Better titles and descriptions on all pages, improved sitemap indexing, min/max length filters for queries
- **Audio downloads** — Download expanded sentence audio directly from the player
- **Visual refresh** — Complete rebrand with new imagery across the site
- **Faster page loads** — Parallel data fetching for sentence and stats calls
- **Preference persistence** — Language settings now survive page reloads
- **Improved authentication** — Magic link login fixed on subpages, better OAuth flow

**Internal improvements:**

- **Pagination overhaul** — Migrated from offset to keyset pagination for better performance at scale
- **Observability** — OpenTelemetry instrumentation, browser error logging, PostHog analytics, health endpoints
- **Infrastructure** — Docker memory limits, connection pooling optimizations, Nuxt cluster mode
- **Elasticsearch** — Zero-downtime reindexing with alias rollback support
- **Discord bot** — Full monitoring integration, guild settings persistence
- **Report system** — Overhauled for better content moderation workflow

## What is Next

More API endpoints are coming to expose advanced search operators, bulk exports, and third-party integrations. The goal is to make Nadeshiko the best possible backend for anyone building Japanese learning tools.

Questions? Join us in [#dev-chat](https://discord.gg/c6yGwbXruq) or read the [API documentation](https://nadeshiko.co/docs/api).

Never stop studying!
