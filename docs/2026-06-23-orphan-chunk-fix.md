# Orphan Chunk Fix — 2026-06-23 (initial) and 2026-06-24 (recovery Worker + tighter TTL)

## The bug

Users reported: `TypeError: Failed to fetch dynamically imported module: https://nadeshiko.co/_nuxt/bqwT2RnV.js`

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

Compounding factor (June 22): the prod frontend was running commit
`736884465d3a45698fddb8f3a0b187240ab47400` (a CLI-deployed image, not a
tagged release). Image `last-modified` was 2026-06-22 16:26 UTC, with
the orphan chunks baked in.

## Round 1 (2026-06-23) — three Cloudflare rules

### 1. `html-no-edge-cache` — Cache Rule
**Where:** CF dashboard → Caching → Cache Rules
**Effect:** Cloudflare edge never stores HTML responses for `nadeshiko.co`
**Why:** Defense in depth — even if a future config change starts emitting edge-cacheable Cache-Control headers, CF won't actually store them.
**Action parameters:**
```json
{"cache": false}
```
**Expression:**
```
(http.host eq "nadeshiko.co" and not (starts_with(http.request.uri.path, "/_nuxt/") or ends_with(http.request.uri.path, ".css") or ends_with(http.request.uri.path, ".js") or ends_with(http.request.uri.path, ".png") or ends_with(http.request.uri.path, ".svg") or ends_with(http.request.uri.path, ".webp") or ends_with(http.request.uri.path, ".woff") or ends_with(http.request.uri.path, ".woff2") or ends_with(http.request.uri.path, ".ico")))
```
**API verification:** `GET /zones/<zone_id>/rulesets/phases/http_request_cache_settings/entrypoint` returns this rule at version 20.

### 2. `v1-api-bypass` — Cache Rule
**Where:** CF dashboard → Caching → Cache Rules
**Effect:** Cloudflare edge never stores `/v1/*` responses on `api.nadeshiko.co`
**Why:** Pre-emptive — once the per-IP rate limiter ships (work in progress as of June 22), CF must NOT cache `/v1/*` responses or the limiter is defeated.
**Action parameters:**
```json
{"cache": false}
```
**Expression:**
```
(http.host eq "api.nadeshiko.co" and starts_with(http.request.uri.path, "/v1/"))
```

### 3. `html-cache-control-5s` — Transform Rule (Modify Response Header)
**Where:** CF dashboard → Rules → Transform Rules → Create rule → Modify Response Header
**Effect:** Every HTML response for `nadeshiko.co` (excluding static asset paths) gets `Cache-Control: public, max-age=5` injected on the way out to the browser.
**Why:** Closes the browser-cached-HTML window. Users with stale HTML from yesterday's deploy revalidate within 5 seconds of any interaction, instead of 60 seconds.
**Header modify:** Set static
**Header name:** `Cache-Control`
**Value:** `public, max-age=5`
**Expression:** (same path-exclusion expression as `html-no-edge-cache`)
**Verification:** `curl -sSI "https://nadeshiko.co/en?cb=$RANDOM" -A "Mozilla/5.0"` returns `cache-control: public, max-age=5` + `cf-cache-status: DYNAMIC`.

## Round 2 (2026-06-24) — TTL=0 + recovery Worker

The 5s `Cache-Control` value helped but didn't fully recover users whose
tabs were left open across the deploy window or whose browser held HTML
through bfcache. Two additions:

### 4. `html-cache-control-0s` — tighter Transform Rule
**Change:** Update the existing `html-cache-control-5s` Transform Rule's
value from `public, max-age=5` to `public, max-age=0`. CF revalidation
becomes mandatory on every navigation; the browser cache window for
HTML effectively drops to zero. Trade-off: one extra CF revalidation
per page view (essentially free against the kamal-proxy origin). Worth
it during the orphan window; can be reverted to `5` once the deploy
pipeline stops producing orphans.

**How to apply:** CF dashboard → Rules → Transform Rules →
`html-cache-control-5s` (rename to `html-cache-control-0s` if you want
to be tidy) → edit → Value field. OR via API: `PUT` the rule with the
new value. The `Set static` action type means a non-empty value
overwrites, no need to first clear.

### 5. CF Worker — `nadeshiko-orphan-chunk-reload`
**Where:** `infra/orphan-chunk-reload-worker/` in this repo.
**Effect:** Catches the case the Transform Rule can't — users whose
browser cached HTML *before* the rule took effect, or whose bfcache
holds stale HTML across deploys. For any `/_nuxt/*.js` request on
`nadeshiko.co` that returns 404 from origin, the Worker returns a tiny
ES module that calls `window.location.reload()`. The browser's
dynamic-import() resolves (no error to the app), the page reloads,
the user gets fresh HTML pointing at the new build's chunk hashes.

**Deploy:** `cd infra/orphan-chunk-reload-worker && bun install && bun run deploy`.
The Worker's `wrangler.toml` pins the route `nadeshiko.co/*` so all
traffic to that host flows through it. Anything outside `/_nuxt/*.js`
is a literal `return fetch(request)` — no overhead, no behavior change.

**Why a Worker and not a Transform Rule:** Transform Rules can't
rewrite a 404 into a 200-with-different-body. They modify headers, not
status codes or bodies. The recovery requires actually replacing the
chunk's response with the reload-trigger script, which only a Worker
can do.

## Architectural decision

The team had already decided (per `frontend/nuxt.config.ts` comment at
line 306-308) that HTML caching decisions live in Cloudflare Cache
Rules / Transform Rules, NOT in `nuxt.config.ts` `routeRules`. The
recovery Worker follows the same principle: it's infrastructure, lives
in `infra/` like the existing seed-worker, deployable independently of
the app code. Anyone debugging cache behavior in 6 months looks in two
places (CF dashboard + `infra/orphan-chunk-reload-worker/`), not three
(CF + nuxt.config.ts + scattered logic).

## What we did NOT change

- `frontend/nuxt.config.ts` — unchanged. The Transform Rule approach
  respects the existing architecture.
- `frontend/server/middleware/00-locale-router.ts` — unchanged. Already
  correctly sets `Cache-Control: private, no-store` for `/` and
  unprefixed redirects.
- `_nuxt/*` chunk cache headers — unchanged
  (`public, max-age=31536000, immutable`). Hash-based filenames never
  collide, so 1-year browser cache is safe.
- The orphan chunks themselves — not deleted from CF edge. They age out
  naturally within their 1-year immutable window. No new HTML
  references them.

## Verification matrix

After Round 2 is fully deployed:

| URL | Expected `cache-control` | Expected `cf-cache-status` | Expected behavior |
|---|---|---|---|
| `https://nadeshiko.co/en` | `public, max-age=0` | `DYNAMIC` | Re-fetches on every nav |
| `https://nadeshiko.co/_nuxt/<currentHash>.js` | `public, max-age=31536000, immutable` | `HIT` (cached) | Passes through Worker untouched |
| `https://nadeshiko.co/_nuxt/<orphanHash>.js` (purged from CF edge) | `no-store` | n/a | Worker returns reload-trigger JS, 200 |
| `https://api.nadeshiko.co/v1/auth/get-session` | `no-store` | `DYNAMIC` | Worker not in route, falls through to origin |

## User-side action (for current affected users)

Users still seeing the orphan chunk error today need to hard-refresh:
- macOS Chrome/Safari/Firefox: `Cmd + Shift + R`
- Windows/Linux: `Ctrl + Shift + R` or `Ctrl + F5`

This clears their browser's local HTML cache. Once the Worker is
deployed + the Transform Rule is at `max-age=0`, affected users will
self-heal on their next navigation (no hard refresh required).

## Token / secret cleanup

- API token used for rule creation: written to `/tmp/cf_token_dir/cf_token`
  with `chmod 600`, then `shred -u` and `rmdir`.
- Pre-existing `/tmp/cf_token` (older `cfut_` token from June 20) also
  `shred -u`'d.
- Both tokens should still be **rotated in CF dashboard** as a
  precaution.

## What I learned (worth remembering)

1. CF Cache Rules and Transform Rules share the same expression parser
   — same fields, same operators. Neither supports
   `http.response.content_type` for filtering, even though some docs
   suggest it does.
2. CF docs contain a misleading example claiming
   `http.response.content_type` works in Transform Rules; it does not.
   Use path-based filtering instead.
3. The Cache Rule API uses `set_cache_settings` with `cache: false` to
   bypass cache. The dashboard exposes this as "Bypass cache" but the
   API doesn't accept the verb `bypass`.
4. `browser_ttl` in Cache Rules only modifies existing Cache-Control
   headers from origin — it does NOT inject one if origin doesn't send
   one. If origin sends no Cache-Control (as Nuxt's `routeRules` does
   by design in this codebase), `browser_ttl` is a no-op.
5. Transform Rule modifications to `cache-control` header do NOT affect
   CF caching behavior — only browser behavior. (CF evaluates caching
   before applying response header modifications.)
6. Transform Rules can't change response status codes or bodies. A
   404→200-with-reload-body recovery requires a CF Worker. Same applies
   to any "serve this synthetic response when origin returns X" use
   case.