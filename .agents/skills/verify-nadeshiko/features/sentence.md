# Sentence permalink

Readers open a sentence's permalink and inspect its Japanese text, translation, media information, and image.

## Sub-features

- `sentence-open` displays a sentence card at its permalink.
- `sentence-text` displays non-empty Japanese text and the English translation badge.
- `sentence-media` displays media information and a successfully loaded image.
- `sentence-search` retains the search input.

## How to get to it (user POV)

Open `/en/sentence/<id>` for an existing result. The existing spec discovers an identifier from a real `彼女` search, then opens `/sentence/<id>`.

## Driving it with Playwright

Preconditions: a local backend and indexed corpus return a result for `彼女` with English translation and reachable image assets. Use valid local credentials, not the About placeholder. Complete the skill's [backend launch](../SKILL.md#local-backend-for-corpus-and-http-checks) and [corpus doctor](../SKILL.md#corpus-readiness) first. Before the browser run, verify that the selected segment's image URL returns a successful image response; a populated search result alone does not prove its assets are reachable.

From `frontend/`, with the absolute evidence directory set:

```sh
E2E_BASE_URL=http://127.0.0.1:4173 E2E_USER_PASSWORD= E2E_SMOKE= \
E2E_RATE_LIMIT_BYPASS_SECRET= E2E_CI_BYPASS_SECRET= \
PLAYWRIGHT_JSON_OUTPUT_FILE="$VERIFY_EVIDENCE/sentence-results.json" \
npx --no-install playwright test --config=e2e/playwright.config.ts \
  e2e/specs/sentence.spec.ts --project=chromium \
  --workers=1 --retries=0 --trace=on --reporter=line,json \
  --output="$VERIFY_EVIDENCE/playwright-sentence" \
  > "$VERIFY_EVIDENCE/sentence.log" 2>&1
result=$?
printf '%s\n' "$result" > "$VERIFY_EVIDENCE/sentence.exit"
test "$result" -eq 0
```

Require the sentence card, non-empty Japanese text, English badge, media information, search input, and an image with non-zero natural width and a successful image response. For permalink behavior changes, additionally assert the displayed card identifier equals the URL identifier. The current generic visibility tests do not prove that relation.

## Gotchas

- The legacy `/s/:id` route follows through to the sentence page and still requires backend data.
- This spec fetches image bytes. A placeholder image URL in fixtures is not sufficient.
- This recipe has not been executed in the documentation pass.
