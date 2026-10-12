---
name: verify-nadeshiko
description: Verify Nadeshiko locally through its real Nuxt pages and existing Playwright harness. Use after refactors, for HTTP compatibility checks, or to capture user-path evidence. Excludes Discord and remote load tests.
---

# Verify Nadeshiko

Follow [the rewrite rules](../../../rewrite-docs/README.md) and read [the feature map](features/README.md) before choosing a recipe. This project-authored skill adapts pstack's `create-verification-skill` workflow, revision `d73344bee8cf22e53b9d5f4cf5749d38ba38c174`. It uses Yuke's workspace skill directory and the existing Playwright harness rather than Cursor tools or a new browser framework.

## Execution status

The launch, doctor, About recipe, cleanup, and evidence-retention check passed locally on 2026-10-10. Five About tests passed without skips. Search, media, and sentence recipes are mapped from source but unexecuted; they require local backend fixtures and are not proven by an About pass. See [execution evidence](../../../rewrite-docs/verification.md#verification-skill-status).

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

The placeholder key is sufficient for About only. It does not prove corpus access. For search, media, or sentence checks, use an isolated local backend with valid local credentials and representative content. Follow contributor setup separately after inspecting its destructive operations. Never bootstrap shared data as part of this skill.

Do not use root `npm run dev`, portless, or `dev:ports` for this isolated recipe. Do not append port flags to the frontend's piped npm dev script.

## Doctor

Require a process owned by this run, a loopback listener, HTTP 200, `Cache-Control: no-store`, and a JSON body with `status: "ok"` and the expected checkout release SHA:

```sh
curl -fsS -D "$VERIFY_EVIDENCE/health.headers" \
  http://127.0.0.1:4173/up > "$VERIFY_EVIDENCE/health.json"
ss -ltnp 'sport = :4173' > "$VERIFY_EVIDENCE/listener.txt"
```

Check the listener PID against the launched process tree. `/up` proves frontend liveness, not backend readiness. Do not use `frontend/scripts/verify-runtime.mjs` on a dev server; it expects production Nitro workers.

## Drive

Use the real app without request mocks. Start with the About recipe, which requires no database. Run from `frontend/`:

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

## Evidence

Keep launch and drive commands, exit codes, health response, listener identity, test logs, JSON reports, and traces under the same evidence directory. `--trace=on` preserves passing-run action timelines, DOM snapshots, and screenshots. Inspect the trace and assertions; an archive alone is not proof. Default screenshots and traces are failure-only and insufficient for a passing-run record.

The feature map names expected results and required fixtures. `/up`, successful hydration, or a search-failure notice is not proof that search works. Confirm result identities, filters, and cursor behavior for affected search paths. For a mutation, also verify persisted effects and restrict writes to disposable fixtures. These initial recipes are anonymous and read-only.

Do not attach credentials, session cookies, or raw environment files. Reports and traces may contain response data; review them before sharing.

## Cleanup

Stop only the managed server job this run started, including its children. If no job manager is available, terminate only recorded process identities after checking that they still belong to this run. Never kill by name, stop Docker, or target another port.

Run cleanup after failed attempts too. Confirm this run no longer listens on port 4173. Preserve evidence and require the JSON report and at least one trace to remain after cleanup. Do not remove application caches, local databases, or proof files as cleanup.

## Helpers

No new executable helper is shipped. Reuse the documented Nuxt command and `frontend/e2e/playwright.config.ts`. See [verification](../../../rewrite-docs/verification.md) for pure backend tests and generated-contract checks. Update the feature map and rerun changed recipes when routes, selectors, or startup requirements change.
