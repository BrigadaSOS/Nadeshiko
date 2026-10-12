# Anonymous search

Readers search Japanese, English, or Spanish text and inspect matching sentence cards.

## Sub-features

- `search-query` opens a direct query URL and displays results.
- `search-submit` submits a new query from the search input.
- `search-categories` displays category tabs for a broad query.
- `search-images` displays images on result cards.

## How to get to it (user POV)

Open `/en/search` or `/en/search/彼女`. Type into `search-input` and activate `search-button` to change the query. `SearchPage` is the existing page-object driver.

## Driving it with Playwright

Preconditions: use a local backend with valid corpus credentials and fixtures matching `彼女`, `school`, `Yo`, and `学校`. The About placeholder key is not sufficient. Complete the skill's [backend launch](../SKILL.md#local-backend-for-corpus-and-http-checks) and [corpus doctor](../SKILL.md#corpus-readiness) first. For navigation/request-lifecycle changes, also use `e2e/specs/search/search-lifecycle.spec.ts` with the same local environment, trace flags, and separate evidence filenames; it checks hydration reuse, word-path navigation, same-URL refresh, and category navigation. It does not prove literal ranking or cursor equivalence.

From `frontend/`, with the absolute evidence directory set:

```sh
E2E_BASE_URL=http://127.0.0.1:4173 E2E_USER_PASSWORD= E2E_SMOKE= \
E2E_RATE_LIMIT_BYPASS_SECRET= E2E_CI_BYPASS_SECRET= \
PLAYWRIGHT_JSON_OUTPUT_FILE="$VERIFY_EVIDENCE/search-results.json" \
npx --no-install playwright test --config=e2e/playwright.config.ts \
  e2e/specs/search/search-results.spec.ts --project=chromium \
  --workers=1 --retries=0 --trace=on --reporter=line,json \
  --output="$VERIFY_EVIDENCE/playwright-search" \
  > "$VERIFY_EVIDENCE/search.log" 2>&1
result=$?
printf '%s\n' "$result" > "$VERIFY_EVIDENCE/search.exit"
test "$result" -eq 0
```

Require matching `segment-card` results, category tabs, images, and a successful query change through the input. For a query-builder refactor, add literal expected result identities, ordering, and cursor assertions using controlled fixtures. The existing broad UI spec is not enough to prove ranking equivalence.

## Gotchas

- Hydration with `search-failure-notice` is a failure, not proof of search.
- Do not use the mocked network scenarios in `search-errors.spec.ts` as real corpus verification.
- The legacy redirect suite follows destinations and can require a backend. A no-follow 301 check proves only redirect headers.
- This recipe has not been executed in the documentation pass. Record unmet data or authentication prerequisites instead of marking it passed.
