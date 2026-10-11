# Query-construction test ownership

These rules apply to `SegmentQuery*.test.ts`, `filterRegistry.test.ts`, and `queryNegation.test.ts`:

- Assert independently expected Elasticsearch DSL, not expectations imported from production constants or private-helper inventories.
- Keep composition checks through `buildSearchMust`: direct multilingual-builder cases cannot detect lost exclusion forwarding. A compact matrix is not redundant merely because it expands to many cases.
- Weighting tests own complete scoring clauses and modes; `../SegmentDocument.reportedContent.test.ts` separately owns delivery of reports/preferences to the actual request. Arithmetic on an imported weight cannot prove both clauses were emitted. Keep expected-query fixtures separate from mutable subject inputs.
- Test media filtering through `buildCommonFilters`. Do not export an internal builder solely to test it. Preserve include/exclude polarity and media-plus-episode conjunctions.
- Boolean/exact/malformed-query bypass fixtures need a real extractable negative. Isolate each guard so a second guard cannot hide its removal.
- Choose sort inputs where ignoring the requested mode would change the expected order; match-all plus a minimum already defaults to ascending length.
- Compare cache-key equivalence alongside contrasting requests. Compare unchanged query values, not object identity, unless a production caller demonstrably requires identity.
- Run these DB-free keepers with `SKIP_DB_PREFLIGHT=1` and explicit file paths. Never apply that bypass to the full backend suite or reset databases as audit housekeeping.
