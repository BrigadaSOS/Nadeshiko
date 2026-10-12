# Nadeshiko verification map

Use the matching recipe after the launch and doctor steps in [verify-nadeshiko](../SKILL.md). These are anonymous local-browser recipes. Do not substitute a remote base URL.

| Feature | Existing harness | Execution status |
| --- | --- | --- |
| [About](about.md) | `frontend/e2e/specs/about.spec.ts` | Five tests passed locally on 2026-10-10; traces retained |
| [Search](search.md) | `frontend/e2e/specs/search/search-results.spec.ts` | Recipe mapped from source; not executed in this documentation pass |
| [Media](media.md) | `frontend/e2e/specs/media.spec.ts` | Recipe mapped from source; not executed in this documentation pass |
| [Sentence](sentence.md) | `frontend/e2e/specs/sentence.spec.ts` | Recipe mapped from source; not executed in this documentation pass |

About requires no corpus database. Search, media, and sentence checks require a local backend, valid local credentials, and representative data. Sentence-image checks also require reachable image assets. A frontend health response is not proof that these dependencies work.

Carry the absolute evidence directory into each call. Set `E2E_BASE_URL` explicitly and clear `E2E_USER_PASSWORD`, smoke mode, and bypass secrets before every anonymous run. This prevents inherited deployment targets and destructive account teardown.

For each feature, preserve the full command, exit status, JSON report, log, and passing-run traces. Use a separate output subdirectory so a later run does not overwrite earlier proof. Read the trace and the asserted results rather than relying on the file count.

These specs cover their named entry points, not every action in the product. Add affected filters, cursor pages, or alternate entry points to the map before claiming those paths were verified. Discord is excluded.
