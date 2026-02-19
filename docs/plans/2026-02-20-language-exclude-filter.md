# Language Exclude Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a user hides EN or ES via the translation visibility toggles, exclude those languages from the Elasticsearch search query so results aren't ranked by content the user can't see. Also sync toggle state via URL query params for SSR consistency.

**Architecture:** Add `languages.exclude` to `SearchFilters` (OpenAPI → generated types → backend). In the ES query builder, strip excluded language sub-queries from the `dis_max` in `buildMultiLanguageQuery`. On the frontend, derive `languages.exclude` from `useTranslationVisibility()` (only when mode is `hidden`) and pass it through both `fetchSentenceData` (SSR) and `SearchContainer` (client). Add `hideLangs` URL query param so SSR renders the correct toggle state on page load.

**Tech Stack:** OpenAPI YAML, Zod (auto-generated), TypeScript, Elasticsearch `dis_max`, Nuxt 4 (Vue 3), Pinia

---

### Task 1: Add `languages` to OpenAPI SearchFilters schema

**Files:**
- Modify: `backend/docs/openapi/components/schemas/SearchFilters.yaml`

**Step 1: Add the languages property to SearchFilters.yaml**

Add a `languages` property to the existing schema:

```yaml
  languages:
    type: object
    description: Language inclusion/exclusion for search matching
    properties:
      exclude:
        type: array
        description: Language codes to exclude from search matching (e.g., ["en"], ["es"], ["en","es"])
        items:
          type: string
          enum: [en, es]
```

This goes after the existing `segmentDurationMs` property in the file.

**Step 2: Regenerate types**

Run: `cd /home/davafons/workspace/Nadeshiko/backend && bun run generate:all`
Expected: Success. `backend/generated/schemas.ts` now contains `languages` in `s_SearchFilters`.

**Step 3: Verify generated output**

Check that `s_SearchFilters` in `backend/generated/schemas.ts` includes the new `languages` field with the `exclude` array.

**Step 4: Commit**

```bash
git add backend/docs/openapi/components/schemas/SearchFilters.yaml backend/generated/
git commit -m "feat: add languages.exclude to SearchFilters OpenAPI schema"
```

---

### Task 2: Add `languages` to backend QueryFilters type and controller mapping

**Files:**
- Modify: `backend/app/types/querySegmentsRequest.ts`
- Modify: `backend/app/controllers/searchController.ts`

**Step 1: Add languages to QueryFilters interface**

In `backend/app/types/querySegmentsRequest.ts`, add to `QueryFilters`:

```typescript
readonly languages?: {
  readonly exclude?: string[];
};
```

**Step 2: Map languages filter in searchController**

In `backend/app/controllers/searchController.ts`, in the `search` handler where `filters` is constructed (around line 30-40), add:

```typescript
languages: f?.languages,
```

to the filters object passed to `querySegments`.

**Step 3: Commit**

```bash
git add backend/app/types/querySegmentsRequest.ts backend/app/controllers/searchController.ts
git commit -m "feat: pass languages.exclude filter through controller to ES service"
```

---

### Task 3: Filter language sub-queries in buildMultiLanguageQuery

**Files:**
- Modify: `backend/app/services/elasticsearch.ts`

This is the core change. `buildMultiLanguageQuery` (line ~1059) currently always includes `contentEn` and `contentEs` queries in the `dis_max`. We need to skip them when excluded.

**Step 1: Add excludeLanguages parameter to buildMultiLanguageQuery**

Change the signature from:
```typescript
const buildMultiLanguageQuery = (
  query: string,
  exactMatch: boolean,
  parserMode: QueryParserMode = 'strict',
): estypes.QueryDslQueryContainer => {
```

to:
```typescript
const buildMultiLanguageQuery = (
  query: string,
  exactMatch: boolean,
  parserMode: QueryParserMode = 'strict',
  excludeLanguages?: string[],
): estypes.QueryDslQueryContainer => {
```

**Step 2: Guard the English and Spanish query blocks**

Before the English query is pushed to `languageQueries`, wrap it:

```typescript
const excludeSet = new Set(excludeLanguages ?? []);
```

Then wrap the English blocks (both exact and non-exact) with:
```typescript
if (!excludeSet.has('en')) {
  // ... existing English query push
}
```

And the Spanish blocks with:
```typescript
if (!excludeSet.has('es')) {
  // ... existing Spanish query push
}
```

Japanese is never excluded (it's the core language).

**Step 3: Thread excludeLanguages through buildTextSearchQuery**

`buildTextSearchQuery` (line ~1271) calls `buildMultiLanguageQuery`. Add the parameter:

```typescript
const buildTextSearchQuery = (
  query: string,
  exactMatch: boolean,
  hasLengthConstraints: boolean,
  parserMode: QueryParserMode = 'strict',
  excludeLanguages?: string[],
): estypes.QueryDslQueryContainer => {
  const baseQuery = buildMultiLanguageQuery(query, exactMatch, parserMode, excludeLanguages);
  // ... rest unchanged
```

**Step 4: Thread excludeLanguages through buildSearchMustQueries**

`buildSearchMustQueries` (around line ~520) calls `buildTextSearchQuery`. Add the parameter and pass it through:

```typescript
// In the function signature, add excludeLanguages parameter
// Then pass it to buildTextSearchQuery:
const textQuery = buildTextSearchQuery(searchTerm, Boolean(q?.exactMatch), hasLengthConstraints, parserMode, excludeLanguages);
```

**Step 5: Pass excludeLanguages from querySegments**

In `querySegments` (line ~568), extract the languages filter and pass it:

```typescript
const { must, isMatchAll, hasQuery } = buildSearchMustQueries(request, parserMode, request.filters.languages?.exclude);
```

**Step 6: Also thread through the multi-word search (searchWords)**

Check `searchWords` / the msearch function (~line 680) that also calls `buildMultiLanguageQuery`. Pass `excludeLanguages` there too, extracted from `filters.languages?.exclude`.

**Step 7: Also update highlight fields**

In `querySegments` where highlight fields are defined (~line 608-621), conditionally exclude highlight fields for excluded languages:

```typescript
const highlightFields: Record<string, estypes.SearchHighlightField> = {
  contentJa: {
    matched_fields: ['contentJa', 'contentJa.kana', 'contentJa.baseform', 'contentJa.normalized'],
    type: 'fvh',
  },
};
const excludeLangs = new Set(request.filters.languages?.exclude ?? []);
if (!excludeLangs.has('en')) {
  highlightFields.contentEn = {
    matched_fields: ['contentEn', 'contentEn.exact'],
    type: 'fvh',
  };
}
if (!excludeLangs.has('es')) {
  highlightFields.contentEs = {
    matched_fields: ['contentEs', 'contentEs.exact'],
    type: 'fvh',
  };
}
```

**Step 8: Commit**

```bash
git add backend/app/services/elasticsearch.ts
git commit -m "feat: exclude language sub-queries from ES dis_max when languages.exclude is set"
```

---

### Task 4: Add `languages` to frontend SearchFilters type and wire into search requests

**Files:**
- Modify: `frontend/app/stores/search.ts` (SearchFilters type)
- Modify: `frontend/app/composables/useTranslationVisibility.ts` (expose excludedLanguages computed)
- Modify: `frontend/app/pages/search/[[query]].vue` (pass filter in SSR fetch)
- Modify: `frontend/app/components/search/SearchContainer.vue` (pass filter in client fetches)

**Step 1: Add languages to frontend SearchFilters type**

In `frontend/app/stores/search.ts`, add to `SearchFilters`:

```typescript
languages?: {
  exclude?: string[];
};
```

**Step 2: Add excludedLanguages computed to useTranslationVisibility**

In `frontend/app/composables/useTranslationVisibility.ts`, add a computed that derives the exclude list:

```typescript
const excludedLanguages = computed(() => {
  const excluded: string[] = [];
  if (englishMode.value === 'hidden') excluded.push('en');
  if (spanishMode.value === 'hidden') excluded.push('es');
  return excluded;
});
```

Return it from the composable.

**Step 3: Wire into search page SSR fetch**

In `frontend/app/pages/search/[[query]].vue`, in `fetchSentenceData` and `fetchStatsData`:

```typescript
const { excludedLanguages } = useTranslationVisibility();

// Inside filters construction:
if (excludedLanguages.value.length > 0) {
  filters.languages = { exclude: excludedLanguages.value };
}
```

Also add `excludedLanguages.value` to `sentenceCacheKey` and `statsCacheKey` so cache keys change when language filter changes.

**Step 4: Wire into SearchContainer client-side fetches**

In `frontend/app/components/search/SearchContainer.vue`, in both `fetchSentences` and `fetchStats`:

```typescript
const { excludedLanguages } = useTranslationVisibility();

// Inside filters construction:
if (excludedLanguages.value.length > 0) {
  filters.languages = { exclude: excludedLanguages.value };
}
```

**Step 5: Trigger re-fetch when language toggle changes**

In `SearchContainer.vue`, watch `excludedLanguages` and re-fetch:

```typescript
watch(excludedLanguages, () => {
  resetSentencePagination();
  fetchStats();
  fetchSentences();
});
```

**Step 6: Commit**

```bash
git add frontend/app/stores/search.ts frontend/app/composables/useTranslationVisibility.ts frontend/app/pages/search/[[query]].vue frontend/app/components/search/SearchContainer.vue
git commit -m "feat: pass languages.exclude filter from frontend translation toggles to search API"
```

---

### Task 5: Add `hideLangs` URL query param for SSR consistency

**Files:**
- Modify: `frontend/app/pages/search/[[query]].vue` (read `hideLangs` from URL)
- Modify: `frontend/app/components/search/TranslationVisibilityPreferences.vue` (update URL on toggle)

**Step 1: Read hideLangs from URL and initialize toggle state on SSR**

In `frontend/app/pages/search/[[query]].vue`, read `hideLangs` from the route query:

```typescript
const hideLangsParam = computed(() => {
  const raw = getStringQueryValue(route.query.hideLangs);
  return raw ? raw.split(',').filter(l => l === 'en' || l === 'es') : [];
});
```

Pass this to `useTranslationVisibility` or use it to derive `excludedLanguages` for the SSR fetch. The composable already initializes from server preferences for logged-in users and from localStorage for guests — on SSR we don't have localStorage, so the URL param fills that gap.

**Step 2: Update URL when toggling languages**

In `TranslationVisibilityPreferences.vue`, after cycling a mode, update the route query:

```typescript
const router = useRouter();
const route = useRoute();
const { excludedLanguages } = useTranslationVisibility();

watch(excludedLanguages, (langs) => {
  const query = { ...route.query };
  if (langs.length > 0) {
    query.hideLangs = langs.join(',');
  } else {
    delete query.hideLangs;
  }
  router.replace({ query });
});
```

Using `router.replace` (not `push`) so toggling doesn't create new history entries.

**Step 3: Initialize composable state from URL on SSR**

In `useTranslationVisibility`, add support for an SSR override. On the server, if `hideLangs` is present in the route query, use it to set the initial mode values:

```typescript
// In the server block of the composable:
if (import.meta.server) {
  const route = useRoute();
  const hideLangs = typeof route.query.hideLangs === 'string'
    ? route.query.hideLangs.split(',')
    : [];
  if (hideLangs.length > 0) {
    const base = user.isLoggedIn ? getServerPreferences() : defaultPreferences();
    if (hideLangs.includes('en')) base.englishMode = 'hidden';
    if (hideLangs.includes('es')) base.spanishMode = 'hidden';
    base.showEnglish = modeToShowFlag(base.englishMode);
    base.showSpanish = modeToShowFlag(base.spanishMode);
    prefs.value = base;
  }
}
```

**Step 4: Commit**

```bash
git add frontend/app/pages/search/[[query]].vue frontend/app/components/search/TranslationVisibilityPreferences.vue frontend/app/composables/useTranslationVisibility.ts
git commit -m "feat: sync language toggle state via hideLangs URL param for SSR consistency"
```

---

### Task 6: Build & verify

**Step 1: Run backend build**

```bash
cd /home/davafons/workspace/Nadeshiko/backend && bun run build
```

Expected: No type errors, clean build.

**Step 2: Run frontend build**

```bash
cd /home/davafons/workspace/Nadeshiko/frontend && bun run build
```

Expected: No type errors, clean build.

**Step 3: Manual test scenarios**

1. Search "eat" with EN visible → results match English content
2. Hide EN → re-search "eat" → results should only match Japanese/Spanish (fewer or no results)
3. Hide both EN and ES → search "hello" → no results (only Japanese searched)
4. Refresh page with `?hideLangs=en` → EN button should render as hidden (gray) on first paint
5. Toggle EN back to show → `hideLangs` param removed from URL
6. Spoiler mode should NOT exclude from search — only hidden does

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: language exclude filter - build verified"
```
