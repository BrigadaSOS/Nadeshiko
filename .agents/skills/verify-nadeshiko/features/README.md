# Nadeshiko verification map

Use the matching recipe after the launch and doctor steps in [verify-nadeshiko](../SKILL.md). The browser recipes are anonymous and read-only; the HTTP recipe checks the local API directly. Do not substitute a remote base URL.

| Feature | Existing harness | Execution status |
| --- | --- | --- |
| [About](about.md) | `frontend/e2e/specs/about.spec.ts` | Five About tests plus the navbar About-link test passed on 2026-10-12; temporary evidence location in the skill |
| [Search](search.md) | `frontend/e2e/specs/search/search-results.spec.ts` | Recipe mapped from source; not executed in this documentation pass |
| [Media](media.md) | `frontend/e2e/specs/media.spec.ts` | Recipe mapped from source; not executed in this documentation pass |
| [Sentence](sentence.md) | `frontend/e2e/specs/sentence.spec.ts` | Recipe mapped from source; not executed in this documentation pass |
| [HTTP compatibility](http.md) | Local curl checks plus explicit backend controller/schema/integration suites | 22 DB-free tests passed on 2026-10-12; backend lifecycle/live fixture requests source-mapped, not executed |

About requires no corpus database. Search, media, and sentence checks require a local backend, valid local credentials, and representative data. Sentence-image checks also require reachable image assets. A frontend health response is not proof that these dependencies work.

Carry the absolute evidence directory into each call. Set `E2E_BASE_URL` explicitly and clear `E2E_USER_PASSWORD`, smoke mode, and bypass secrets before every anonymous run. This prevents inherited deployment targets and destructive account teardown.

For each feature, preserve the full command, exit status, JSON report, log, and passing-run traces. Use a separate output subdirectory so a later run does not overwrite earlier proof. Read the trace and the asserted results rather than relying on the file count.

These specs cover their named entry points, not every action in the product. Before driving, list the entry points affected by the change and match each to a recipe/assertion. Exercise every affected entry point: direct/localized URLs, header links, legacy redirects, query-string navigation, filters, and cursor pages where relevant. A direct page load does not prove a link or redirect works. If a listed path lacks a real harness check, add one or report it as unverified; do not claim the entire feature passed. Update the map alongside the check. Discord is excluded.
