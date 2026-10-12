# Media catalog

Readers browse titles, filter the catalog, change its view, and open a title's own page.

## Sub-features

- `media-grid` displays populated title cards.
- `media-title` opens the first title's canonical slug page.
- `media-filter` searches a title name and filters by category.
- `media-view` displays grid and list views.

## How to get to it (user POV)

Open `/en/media`. Use `media-search-input`, the category control, or the view controls. Click a `media-card-container` to reach `/media/<slug>`. `MediaPage` is the existing page object.

## Driving it with Playwright

Preconditions: an owned local frontend points to a local backend with valid credentials and populated Postgres media, including anime. Opening a title also requires its search dependencies.

From `frontend/`, with the absolute evidence directory set:

```sh
E2E_BASE_URL=http://127.0.0.1:4173 E2E_USER_PASSWORD= E2E_SMOKE= \
E2E_RATE_LIMIT_BYPASS_SECRET= E2E_CI_BYPASS_SECRET= \
PLAYWRIGHT_JSON_OUTPUT_FILE="$VERIFY_EVIDENCE/media-results.json" \
npx --no-install playwright test --config=e2e/playwright.config.ts \
  e2e/specs/media.spec.ts --project=chromium \
  --workers=1 --retries=0 --trace=on --reporter=line,json \
  --output="$VERIFY_EVIDENCE/playwright-media" \
  > "$VERIFY_EVIDENCE/media.log" 2>&1
result=$?
printf '%s\n' "$result" > "$VERIFY_EVIDENCE/media.exit"
test "$result" -eq 0
```

Require populated cards with non-empty `media-card-title`, a title click ending at a slug URL, a name filter retaining results, category selection, and the expected grid or list view. Capture the query URL and resulting cards in the traces.

## Gotchas

- An empty development database is not a successful catalog check.
- Do not reset or seed a shared database to satisfy this recipe.
- The name-filter test derives its input from an actual title, but the category test requires anime content.
- This recipe has not been executed in the documentation pass.
