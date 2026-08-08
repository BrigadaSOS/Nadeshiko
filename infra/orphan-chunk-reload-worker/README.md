# Orphan Chunk Reload Worker

CF Worker that self-heals users hitting the
`Failed to fetch dynamically imported module: /_nuxt/<hash>.js` error
after a Nuxt deploy that changed chunk hashes.

## What it does

When the browser's cached HTML references a chunk the current build no
longer ships, the chunk request hits this Worker. The Worker asks the
origin (bypassing CF edge cache), and:

- **If origin returns 404** (chunk is gone): returns a tiny ES module
  that calls `window.location.reload()`. The browser's dynamic-import
  resolves cleanly, then the page reloads and the user fetches fresh
  HTML pointing at the new build's chunk hashes.
- **If origin returns anything else** (chunk exists, 5xx, etc.):
  passes the response through unchanged.
- **If the request URL doesn't match `/_nuxt/*.js` on `nadeshiko.co`**:
  passes through unchanged. Every other request to the zone is a
  no-op for this Worker.

## Why it exists

After every CLI redeploy, Nuxt produces a new build with new chunk
hashes. The previous build's chunks age out of CF edge cache within
~24h, but the previous build's HTML can stay in a user's browser cache
for the duration of `Cache-Control: max-age=N` on the HTML response.

When that stale HTML runs and tries to dynamic-import an orphan chunk
URL, the chunk itself may still load from CF edge (it has
`max-age=31536000, immutable`), but its transitive dynamic-import()
graph references chunks the new build deleted. The user's browser sees
the failure and reports the outermost URL in the console, which is
misleading — that URL loaded fine.

The Transform Rule `html-cache-control-5s` shrinks the forward window
to 5s. This Worker covers the backward window: tabs left open across
the deploy, users on slow `Cache-Control` overrides, etc.

## Scope

- **Hosts**: `nadeshiko.co` only. `api.nadeshiko.co`, `stg.nadeshiko.co`,
  `api-stg.nadeshiko.co` are NOT routed.
- **Paths**: only `/_nuxt/*.js`. HTML, API routes, static assets,
  images, fonts all pass through.
- **Methods**: any (GET is the realistic case; HEAD, OPTIONS, etc. fall
  through the gate too).
- **Caching**: the Worker's own outbound fetch to origin uses
  `cf: { cacheTtl: 0, cacheEverything: false }` to bypass the CF edge
  cache for this code path, so we always observe the current state of
  the chunk. The synthetic reload-trigger response sets
  `Cache-Control: no-store` so it can't be cached anywhere downstream.

## Deploy

```bash
cd infra/orphan-chunk-reload-worker
bun install
bun run deploy
```

The `wrangler.toml` pins `account_id = 69706df70c95c734ba43a679b10a5bf9`
and a `[[routes]]` entry for `nadeshiko.co/*`. The route takes
precedence over any earlier Worker routes on the zone — make sure no
other Worker is already covering the same pattern.

## Testing locally

```bash
bun run dev
# wrangler will start a local server; test:
curl -sI http://localhost:8787/_nuxt/nonexistent-test-chunk.js
# Should return 200 with Content-Type: application/javascript
```

For an end-to-end test against prod:

1. Open `https://nadeshiko.co/en` in a browser.
2. Open DevTools → Network → filter by `JS`.
3. Note a current chunk URL (e.g. `/en/_nuxt/B5PXAU2c.js`-equivalent).
4. Trigger a synthetic orphan: rename the chunk URL in DevTools'
   network override, or run
   `curl -sI "https://nadeshiko.co/_nuxt/nonexistent-deadbeef.js" -A "Mozilla/5.0"`.
5. Confirm the response is `200 application/javascript` with
   `Cache-Control: no-store`, body starts with `if (typeof window ...)`.

To test the happy path: any existing `/_nuxt/*.js` chunk should return
its normal `application/javascript` body with the kamal-proxy cache
headers, NOT the reload-trigger.

## Rollback

The route is the only thing that wires this Worker into traffic. To
disable without removing the deployment:

1. CF dashboard → Workers & Pages → `nadeshiko-orphan-chunk-reload` →
   Settings → Triggers → Routes.
2. Delete the `nadeshiko.co/*` route entry.
3. Save.

Subsequent requests will route directly to origin, no Worker
intervention.

## Limitations / known gaps

- **The reload loses client state.** Forms in flight, partial scrolls,
  the back-stack entry — all gone. Acceptable because the failure mode
  is a broken page anyway; better to land on a fresh, working page
  than to leave the user on a half-broken one.
- **A 404 in the orphan set is the only signal we trust.** If kamal-proxy
  or CF returns a 5xx for a chunk that actually exists, we pass the 5xx
  through. The user sees the same error they'd see without the Worker.
- **The Worker doesn't fix the root cause.** New CLI redeploys create
  new orphans; this Worker recovers affected users after the fact. The
  real fix is to get tagged releases flowing through `release.yml`
  again (and/or to ship a deploy-day CF purge of
  `/_nuxt/*` not referenced by the new build). See
  `docs/2026-06-23-orphan-chunk-fix.md` for context.

## Files

- `src/index.ts` — Worker source.
- `wrangler.toml` — name, account_id, route binding.
- `package.json` — wrangler + workers-types devDependencies.
- `tsconfig.json` — strict TS, workers-types lib only.