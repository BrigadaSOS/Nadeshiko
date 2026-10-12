# Local HTTP compatibility

API consumers read media and search segments through the backend. Anonymous browser clients reach the same public corpus routes through Nuxt's SERVICE-key proxy. Verify both boundaries when a change affects them.

## Sub-features

- `http-auth` enforces existing authentication and `READ_MEDIA` permissions.
- `http-media` returns the declared media fixture and its existing wire fields.
- `http-search` returns the declared segment identities, text, ordering, expansions, filters, and pagination.
- `http-contract` preserves methods, validation, errors, status codes, headers, response bodies, and generated/published contracts.

## How to get to it (user POV)

Call `GET /v1/media`, `GET /v1/media/:mediaPublicId`, and `POST /v1/search` at `http://127.0.0.1:5000` with an existing local SERVICE key. For anonymous-proxy checks, call the affected routes at `http://127.0.0.1:4173` without Authorization or cookies. Never substitute a deployment URL.

Read the skill's [backend launch](../SKILL.md#local-backend-for-corpus-and-http-checks) and [corpus doctor](../SKILL.md#corpus-readiness) first. Fixture provisioning is separate; this recipe does not create keys, seed, migrate, or reset data. It is source-mapped and has not been executed end to end.

## Driving it with curl and Vitest

### Authenticated fixture readiness

Use the absolute `VERIFY_EVIDENCE` directory in each call. Privately supply `VERIFY_API_KEY` as an existing SERVICE key with `READ_MEDIA`, and `VERIFY_MEDIA_PUBLIC_ID` as the declared 12-character media fixture ID. Keep shell tracing off. Record literal expected media ID/slug/names/category and segment ID/Japanese text/media ID from the fixture definition before observing responses; do not derive expectations from those responses. Declare additional fixtures for language, ranking, filters, or cursor checks when affected.

The following calls do not mutate corpus content, but authentication can update last-seen metadata. USER keys additionally consume quota; do not use one as the anonymous proxy key. These are not zero-write database checks.

```sh
printf 'Authorization: Bearer %s\n' "$VERIFY_API_KEY" |
  curl --noproxy '*' --silent --show-error --fail-with-body --max-time 15 \
    --header @- \
    -D "$VERIFY_EVIDENCE/media.headers" -o "$VERIFY_EVIDENCE/media.json" \
    'http://127.0.0.1:5000/v1/media?take=1'

printf 'Authorization: Bearer %s\n' "$VERIFY_API_KEY" |
  curl --noproxy '*' --silent --show-error --fail-with-body --max-time 15 \
    --header @- \
    -D "$VERIFY_EVIDENCE/media-detail.headers" -o "$VERIFY_EVIDENCE/media-detail.json" \
    "http://127.0.0.1:5000/v1/media/$VERIFY_MEDIA_PUBLIC_ID"
```

Require HTTP 200 for both calls, a populated list, and detail fields equal to the predeclared fixture. The listing's first item need not be the chosen fixture; the detail request establishes its identity. Build a nonsecret request scoped to that media:

```sh
node --input-type=module - "$VERIFY_MEDIA_PUBLIC_ID" "$VERIFY_EVIDENCE/search.request.json" <<'JS'
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [mediaPublicId, output] = process.argv.slice(2);
assert.match(mediaPublicId, /^[A-Za-z0-9_-]{12}$/);
writeFileSync(output, JSON.stringify({
  query: { search: '彼女', exactMatch: false },
  take: 1,
  sort: { mode: 'TIME_ASC' },
  filters: {
    status: ['ACTIVE'],
    media: { include: [{ mediaPublicId }] },
    languages: [],
  },
  include: ['media'],
}, null, 2));
JS

printf 'Authorization: Bearer %s\n' "$VERIFY_API_KEY" |
  curl --noproxy '*' --silent --show-error --fail-with-body --max-time 30 \
    --header @- --header 'Content-Type: application/json' \
    --data-binary @"$VERIFY_EVIDENCE/search.request.json" \
    -D "$VERIFY_EVIDENCE/search.headers" -o "$VERIFY_EVIDENCE/search.json" \
    http://127.0.0.1:5000/v1/search
```

Require HTTP 200, the literal expected `segments[0].publicId`, `textJa.content`, and `mediaPublicId`, plus the matching media in `includes.media`. An empty 200 response is a blocker. Check wire bodies against `s_MediaListResponse`, `s_Media`, and `s_SearchResponse` in `backend/generated/schemas.ts`; schema acceptance is additional evidence, not a replacement for literal assertions. Use `backend/tests/helpers/openapiContract.ts` for existing controller-test schema assertions.

For affected anonymous browser/proxy paths, launch Nuxt with `NUXT_NADESHIKO_API_KEY="$VERIFY_API_KEY"` as documented, then repeat without a credential header or cookies:

```sh
curl --noproxy '*' --silent --show-error --fail-with-body --max-time 15 \
  -D "$VERIFY_EVIDENCE/proxy-media.headers" -o "$VERIFY_EVIDENCE/proxy-media.json" \
  "http://127.0.0.1:4173/v1/media/$VERIFY_MEDIA_PUBLIC_ID"
curl --noproxy '*' --silent --show-error --fail-with-body --max-time 30 \
  --header 'Content-Type: application/json' \
  --data-binary @"$VERIFY_EVIDENCE/search.request.json" \
  -D "$VERIFY_EVIDENCE/proxy-search.headers" -o "$VERIFY_EVIDENCE/proxy-search.json" \
  http://127.0.0.1:4173/v1/search
```

Require the same fixture identities and content. This exercises actual proxy key injection (`frontend/server/utils/backendProxy.ts`), not just direct backend auth. For sentence checks, additionally fetch the declared segment through `GET /v1/media/segments/:segmentPublicId` and verify its identity, translation, and reachable image before driving the permalink. Do not attach credential headers to asset requests.

Record each curl exit status, headers/status, request body, parsed response assertions, and failures. No-follow curl calls do not prove redirect destinations render. A successful health probe or valid schema is not a corpus pass.

### Compatibility checks for an affected endpoint

1. Record `git status --short`, checkout SHA, relevant pre-existing diffs, and snapshots of affected OpenAPI source, generated contracts, and published documentation before editing. Include untracked files. Compare the before/after snapshots, not just HEAD: existing user edits are not this task's regressions. Relevant boundaries include `backend/docs/openapi`, `backend/docs/generated`, `backend/generated`, `frontend/server/utils/generated`, and `packages/nadeshiko-sdk/generated`. For an equivalence refactor, require unchanged wire/auth contracts; isolate intentional behavior changes separately.
2. Exercise real HTTP methods, input validation, unauthenticated/invalid-key cases, status codes, errors, headers, and response bodies for the affected endpoint. Assert literal expected statuses/bodies from its existing contract. Do not create production credentials, invoke mutation routes on shared data, or mistake the anonymous Nuxt proxy for an unauthenticated backend call.
3. For search execution changes, assert literal expected identities/order, affected filter combinations, and cursor pages using controlled fixtures. Require page-two identities and no duplicated segments. A schema diff cannot detect a ranking regression. Repeat affected browser entry points from the feature map.
4. Run the relevant existing tests below, distinguishing their boundaries and skips. Rerun the same unchanged behavior assertions before/after; store results separately. Regenerate affected contracts with the existing package commands only when relevant, and preserve unrelated generated changes. The local `openapi:breaking` wrapper needs both `oasdiff` and its referenced `backend/node_modules/.bin/redocly`; check availability before treating it as a gate. A breaking-change detector alone is not behavioral proof.

### Existing tests and their limits

From `backend/`, these explicit suites are DB-free:

```sh
SKIP_DB_PREFLIGHT=1 npx --no-install vitest run \
  tests/controllers/searchController.test.ts \
  tests/controllers/searchFilters.test.ts \
  tests/routes/tokenSchemaAgreement.test.ts
```

Search controller tests mock `SegmentDocument` and call controllers directly; they check mapping/generated schemas, not live HTTP, real credentials, or Elasticsearch. Filter tests cover request/filter behavior; reassess current source if it changes. Token agreement checks served generated fields. Use `SKIP_DB_PREFLIGHT=1` only for known DB-free suites, never the full backend suite.

Only after separately approving dedicated disposable test resources and inspecting `.env.test`/`.env`, run:

```sh
npx --no-install vitest run \
  tests/controllers/mediaController.test.ts \
  tests/controllers/segmentController.test.ts
```

These use real Express/generated routes and Postgres fixtures but inject authentication and disable rate limiting (`backend/tests/helpers/setup.ts`). They write fixture data, usually inside rollback transactions; they do not prove actual credential enforcement.

Search execution integration is a separate destructive test path:

```sh
npx --no-install vitest run tests/services/search/SegmentDocument.test.ts
```

Its search setup deletes all documents in the target Elasticsearch index and truncates Segment/Episode/Media tables with cascade (`backend/tests/helpers/searchSetup.ts`). Never point it at browser-readiness fixtures or shared data. Require dedicated disposable test resources with exclusive ownership. Preflight loads `.env.test` with overrides, then fills absent keys from `.env`; shell overrides do not reliably retarget these suites. Review effective database/index targets without exposing passwords. Do not change environment files or automatically run `test:setup` to unblock this skill.

The Elasticsearch integration group can skip while the mocked group passes. Require actual integration assertions and report all skips; green exit status alone is not search proof. Root `npm run test` also includes Discord and is not this recipe.

## Gotchas

- Backend boot binds wildcard and starts workers: disabling migrations is not isolation or read-only startup.
- Backend `/up` can return 200 with Elasticsearch down; explicitly check its JSON fields.
- No key creation, setup, reset, migration, reindex, or container shutdown belongs in doctor/cleanup.
- SERVICE-key auth can still write last-seen metadata. Restrict even corpus-read requests to the approved environment.
- Error requests expected to return 4xx make `curl --fail-with-body` exit nonzero. Capture that expected status/body explicitly rather than treating every nonzero exit as an infrastructure failure.
- Logs/traces may include response data or credentials. Keep tracing off for credential handling; redact reviewed artifacts before sharing.
- This recipe remains unexecuted until a real backend/fixture lifecycle, assertions, and cleanup have their own evidence. See the skill's [cleanup](../SKILL.md#cleanup) and [evidence](../SKILL.md#evidence) requirements.
