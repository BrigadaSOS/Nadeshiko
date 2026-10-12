---
name: verify-nadeshiko
description: Verify Nadeshiko locally through real Nuxt pages, local HTTP endpoints, and the existing Playwright/Vitest harnesses. Use after refactors, for HTTP compatibility checks, or to capture user-path evidence. Excludes Discord and remote load tests.
---

# Verify Nadeshiko

Read [the feature map](features/README.md) before choosing a recipe. For refactors, keep the scope bounded, preserve existing behavior and compatibility, and verify affected paths before and after the change. This project-authored skill adapts pstack's `create-verification-skill` workflow, revision `d73344bee8cf22e53b9d5f4cf5749d38ba38c174`. It uses Yuke's workspace skill directory and the existing Playwright harness rather than Cursor tools or a new browser framework.

## Execution status

Historical baseline: the launch, doctor, About recipe, cleanup, and evidence-retention check passed locally on 2026-10-10. The original temporary evidence is no longer available; that summary is not a current readiness check.

On 2026-10-12, launch and doctor passed again, all five About tests and the anonymous navbar About-link test passed without skips or retries, and inspected traces contained the localized About page, content, navigation actions, and screenshots. After stopping the owned Nuxt job, port 4173 was free and both reports plus six traces remained under `/tmp/nadeshiko-verify.RpBzhD`. This is temporary local evidence, not a portable or permanent archive; check it exists before citing it.

The added backend launch/doctor and live HTTP fixture checks are source-checked but not executed. On 2026-10-12, the HTTP recipe's three explicit DB-free controller/filter/token-schema suites passed (22 tests, no skips); their log, exit code, and JSON report are in the same evidence directory. This run used the current working tree, including pre-existing search-controller/filter edits, not pristine HEAD. Those tests do not prove live authentication, routing, or Elasticsearch execution. Search, media, and sentence recipes still require local backend fixtures; no corpus or API compatibility result follows from the About or mocked/schema passes.

## Launch

Work from the repository root with installed dependencies and Node 24 or later. Preserve existing environment files. Do not print credentials or overwrite `.env`.

Before launch, check `ss -ltnp 'sport = :4173'` and inspect existing Nuxt processes. Refuse an occupied port or a second Nuxt dev server in this checkout. Different ports still share `frontend/.nuxt`. Do not stop another session's server.

Create evidence outside the checkout:

```sh
VERIFY_EVIDENCE=$(mktemp -d /tmp/nadeshiko-verify.XXXXXX)
printf '%s\n' "$VERIFY_EVIDENCE"
```

Carry the absolute evidence path into every subsequent tool call. Shell exports do not survive fresh tool shells. Start this foreground command as a managed background job and keep its job identifier or exact process identity:

```sh
cd frontend
NUXT_PUBLIC_ENVIRONMENT=local \
NUXT_BACKEND_INTERNAL_URL=http://127.0.0.1:5000 \
NUXT_NADESHIKO_API_KEY=verify-local-placeholder \
NUXT_RATE_LIMIT_BYPASS_SECRET= NUXT_SHIRABE_API_KEY= \
NUXT_HOST=127.0.0.1 NUXT_PORT=4173 \
NUXT_RELEASE_SHA=$(git rev-parse HEAD) \
npx --no-install nuxt dev --host 127.0.0.1 --port 4173 \
  > "$VERIFY_EVIDENCE/nuxt.log" 2>&1
```

The placeholder key is sufficient for About only. It does not prove corpus access. For corpus checks, complete the backend preconditions below and the corpus doctor, then use the same Nuxt command with `NUXT_NADESHIKO_API_KEY="$VERIFY_API_KEY"` instead of the placeholder. Supply the existing local SERVICE key privately in that shell; keep tracing off and never put its literal value in a recorded command. Do not modify environment files to switch targets.

Do not use root `npm run dev`, portless, or `dev:ports` for this isolated recipe. Do not append port flags to the frontend's piped npm dev script.

### Local backend for corpus and HTTP checks

Read [contributor setup](../../../CONTRIBUTING.md#getting-started) for prerequisites, not as an automatic verification command. Setup starts Docker, migrates, and seeds; backend `test:setup` drops/rebuilds tables and resets Elasticsearch. Provision fixtures separately with approval. Never bootstrap shared data to satisfy a recipe.

Require all of the following before starting a backend:

- Existing, dedicated disposable Postgres and Elasticsearch fixtures, a migrated schema, representative media/segments, and an existing SERVICE key with `READ_MEDIA`. Declare the fixture's media public ID and literal expected media/segment values before observing responses. Browser corpus checks also need the queries named by their recipes and reachable assets.
- An absolute `VERIFY_BACKEND_ENV` path to an existing reviewed private configuration. Review `backend/config/config.ts` and `backend/.env`: boot loads `.env` as a fallback even with `--env-file`. The effective configuration must target only the approved resources and explicitly leave unused external integrations/credentials empty; do not assume missing keys disable fallback. Do not print or overwrite these files.
- Pre-established network containment for ingress and unintended external egress. `backend/main.ts` calls `server.listen(port)` without a host, so it binds wildcard. Setting `HOST=127.0.0.1` does not isolate it. If containment is unavailable, report launch blocked rather than changing firewall/network configuration as part of this skill.
- A free port 5000 (`ss -ltnp 'sport = :5000'`), no competing backend process in this checkout, and no other runtime using the fixture database/index. The stable lock below prevents only cooperating runs; process/resource checks are still required.

Backend startup is not read-only: workers create/update queues, schedule jobs, and may process existing work (`backend/config/initializers/workers.ts`). `RUN_MIGRATIONS_ON_BOOT=false` disables boot migrations, not workers. The direct entry point avoids dev-time generation/watch mode and does not invoke setup; there is no bootstrap-disable or worker-disable flag to invent.

From the repository root, compute a stable per-checkout lock, carry its absolute path and the private env path into subsequent tool calls, and start this command as a managed background job:

```sh
VERIFY_BACKEND_LOCK="/tmp/nadeshiko-backend-$(printf '%s' "$(pwd -P)" | sha256sum | cut -c1-16).lock"
cd backend
flock -n "$VERIFY_BACKEND_LOCK" \
  env -i PATH="$PATH" HOME="$HOME" \
    ENVIRONMENT=local PORT=5000 BASE_URL=http://127.0.0.1:5000 \
    RELEASE_SHA="$(git rev-parse HEAD)" \
    RUN_MIGRATIONS_ON_BOOT=false LIFECYCLE_EMAILS_ENABLED=false \
    POSTHOG_API_KEY= OTEL_EXPORTER_OTLP_ENDPOINT= SHIRABE_API_KEY= \
    POSTGRES_ADMIN_PASSWORD= ELASTICSEARCH_ADMIN_PASSWORD= \
    node --env-file="$VERIFY_BACKEND_ENV" --import tsx main.ts \
    > "$VERIFY_EVIDENCE/backend.log" 2>&1
```

Require Linux `flock` and `sha256sum`; refuse a held lock. Preserve the managed job identifier/process tree and inspect startup failures without leaking credentials. A failed launch still requires cleanup.

## Doctor

For frontend/browser/proxy runs, require a process owned by this run, a loopback listener, HTTP 200, `Cache-Control: no-store`, and a JSON body with `status: "ok"` and the expected checkout release SHA:

```sh
curl -fsS -D "$VERIFY_EVIDENCE/health.headers" \
  http://127.0.0.1:4173/up > "$VERIFY_EVIDENCE/health.json"
ss -ltnp 'sport = :4173' > "$VERIFY_EVIDENCE/listener.txt"
```

Check the listener PID against the launched process tree. `/up` proves frontend liveness, not backend readiness. Do not use `frontend/scripts/verify-runtime.mjs` on a dev server; it expects production Nitro workers.

### Corpus readiness

For backend/API or corpus-browser recipes, also run:

```sh
curl --noproxy '*' --silent --show-error --fail-with-body --max-time 10 \
  -D "$VERIFY_EVIDENCE/backend-health.headers" \
  -o "$VERIFY_EVIDENCE/backend-health.json" \
  http://127.0.0.1:5000/up
ss -ltnp 'sport = :5000' > "$VERIFY_EVIDENCE/backend-listener.txt"
```

Require this run's listener/process tree within the declared network containment, HTTP 200, `Cache-Control: no-store`, `CDN-Cache-Control: no-store`, and JSON fields `status: "ok"`, `database: "up"`, `elasticsearch: "up"`, and `releaseSha` equal to the launch SHA. Elasticsearch failure can still return 200; check the body, not just the status (`backend/config/routes.ts`). No listener implies startup failure; review this run's log instead of provisioning resources automatically.

Next run the [HTTP recipe's authenticated fixture checks](features/http.md#driving-it-with-curl-and-vitest). They must prove the declared media and search result identities, not merely connectivity or a nonempty response. For browser recipes, repeat affected requests through anonymous Nuxt `/v1/...` routes after launching Nuxt with the valid local SERVICE key. Do not drive search/media/sentence until these checks pass. Missing credentials, content, translations, or reachable assets are explicit blockers.

## Drive

Use the real app without request mocks. For browser verification, start with the About recipe, which requires no database. Backend-only HTTP runs can skip Nuxt and About unless the proxy or a browser entry point is affected. Run the About check from `frontend/`:

```sh
E2E_BASE_URL=http://127.0.0.1:4173 \
E2E_USER_PASSWORD= E2E_SMOKE= \
E2E_RATE_LIMIT_BYPASS_SECRET= E2E_CI_BYPASS_SECRET= \
PLAYWRIGHT_JSON_OUTPUT_FILE="$VERIFY_EVIDENCE/about-results.json" \
npx --no-install playwright test --config=e2e/playwright.config.ts \
  e2e/specs/about.spec.ts --project=chromium \
  --workers=1 --retries=0 --trace=on --reporter=line,json \
  --output="$VERIFY_EVIDENCE/playwright-about" \
  > "$VERIFY_EVIDENCE/about.log" 2>&1
result=$?
printf '%s\n' "$result" > "$VERIFY_EVIDENCE/about.exit"
test "$result" -eq 0
```

Always set the local target explicitly and clear `E2E_USER_PASSWORD`. The Playwright config and global teardown load `backend/.env`. A non-empty password allows teardown to log in and delete account data even after anonymous tests. Keep it empty for these read-only recipes. Clear smoke mode so About is not filtered out.

Never invoke `test:e2e:dev`, staging, or production wrappers as a local check. The `dev` wrapper targets staging. The existing Playwright config does not launch the application.

For API changes, use the [HTTP compatibility recipe](features/http.md) as well as affected browser paths. Controller/schema tests alone do not prove authentication, routing, Elasticsearch execution, or compatibility behind an unchanged schema.

## Evidence

Keep launch and drive commands, exit codes, health response, listener identity, test logs, JSON reports, and traces under the same evidence directory. `--trace=on` preserves passing-run action timelines, DOM snapshots, and screenshots. Inspect the trace and assertions; an archive alone is not proof. Default screenshots and traces are failure-only and insufficient for a passing-run record.

The feature map names expected results and required fixtures. List affected entry points before driving and exercise each one, not just the easiest route. Direct navigation does not prove a header click, localized route, or legacy redirect; add missing checks or explicitly report the path as unverified. `/up`, successful hydration, or a search-failure notice is not proof that search works. Confirm result identities, filters, and cursor behavior for affected search paths. For a mutation, also verify persisted effects and restrict writes to disposable fixtures. The browser recipes are anonymous and read-only; the HTTP recipe requires a local SERVICE key and can update auth metadata even for corpus reads.

Record each run's date, checkout SHA and relevant working-tree changes, feature/entry points, commands, pass/fail/skip counts, unmet prerequisites, cleanup result, and absolute evidence directory in the handoff. Confirm the files remain after cleanup before recording a pass. Historical execution status is not proof for the current checkout. Temporary directories can disappear; if a durable record is needed, copy only reviewed, sanitized artifacts to an agreed location.

Do not attach credentials, session cookies, or raw environment files. Reports and traces may contain response data; review them before sharing.

## Cleanup

Stop only the managed server job this run started, including its children. If no job manager is available, terminate only recorded process identities after checking that they still belong to this run. Never kill by name, stop Docker, or target another port.

Run cleanup after failed attempts too. Confirm this run no longer listens on port 4173 and, if started, port 5000; verify both recorded process trees have exited. Stop frontend/backend jobs only, not their database containers. Let the backend process release its lock; do not delete a lock file another run may hold. Preserve evidence: browser runs require the JSON report and at least one inspected trace; HTTP-only runs require request bodies, response bodies/headers, assertions, logs, and exit codes. Do not remove application caches, local databases, or proof files as cleanup.

## Helpers

No new executable helper is shipped. Reuse the documented launch commands and `frontend/e2e/playwright.config.ts`.

## Maintenance

Update this skill and the feature map when routes, selectors, credentials, fixtures, contracts, or startup requirements change. Rerun changed recipes through launch, doctor, drive, evidence inspection, and cleanup; record the new result and evidence location. Keep unexecuted recipes explicitly marked, and do not turn an old pass into a current claim without rerunning it. This is the local maintenance workflow; no Cursor-only maintenance command is installed.
