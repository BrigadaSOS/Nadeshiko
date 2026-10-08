# Applying corpus audit visibility proposals

On 2026-10-09 the user authorized selective, reversible preventive hiding of
strong core Hide candidates and clearly broken episode clusters while the full
scan continues. Review and Spanish-only flags are excluded from this early mode.
The commands below describe both the bounded early rollout and the final rollout.

`HIDDEN` means excluded from normal search, whose default status filter is
`ACTIVE`. The existing direct segment endpoint and sentence page still return
the segment. Explicit administrative searches can request hidden content, and
episode/context APIs can still include it. This operation does not delete assets,
rewrite subtitles, hide Spanish-only issues, or resolve user reports.

## Dry run

Run inside the deployed backend environment, or a development environment with
the intended DB configured. The dry run uses read-only transactions and does not
fetch audio, update Postgres, create revisions, or touch Elasticsearch. It prints
the exact manifest hash, batch size, next offset, proposed changes and conflicts.

```bash
npm run corpus:audit -w backend -- \
  --manifest /path/hide-core-candidates.jsonl --offset 0 --limit 100
```

The file must contain unique Hide/Review core proposals, original ACTIVE status,
source text/timings/key and hashes. The Spanish manifest is not an apply input.
Parsing checks the entire manifest even when the selected batch is smaller.
Rows are sorted by numeric ID, making offsets stable for the frozen file.

Before applying, retain the exact manifest, its independent verification file,
and this command's dry-run receipts. Do not apply a file while a live producer is
still changing it. Writes require complete final corpus verification bound to
the file's exact SHA256 and the final adjudication policy. A partial first-pass
verification is sufficient for inspection. The separately authorized preventive
mode below requires its own frozen, independently verified bounded manifest.

## Preventive episode batches

The audit workspace's `preventive_batch.py` selects only high-confidence core
Hide candidates from the five identified episode clusters. Its `--dual-core`
mode selects additional individual Hides only when both audio/Japanese and
Japanese/English checks have literal high-confidence evidence, ASR marks Japanese
speech clean, speech lasts at least three seconds, Japanese has at least eight
alphanumeric characters and English has at least four words. Prior published IDs
are excluded, and every frozen manifest remains bounded to 1000 rows. It independently
binds each row to the frozen catalog, shard inventory, stored full large-v3 ASR,
asset hash and signed primary evidence packet. Literal Japanese and comparison
quotes must exist in the supplied text. The parent manifest must match the
independently verified first-pass checkpoint. Its `preventive-batch` proof is
explicitly separate from full-corpus final verification.

The expanded Hide-only rollout uses the audit workspace's
`side_reassessment.py`, `verify_side_reassessment.py` and `confirmed_publication.py`.
It freezes an independently verified candidate cohort, obtains independent CPU
Japanese ASR and two blinded `gpt-6.1-sol` checks, and publishes only eligible
core Hides confirmed at high confidence by both checks. Review, cleared outcomes, Spanish-only
concerns, changed/incomplete audio and short audio-only concerns are held.
Publication preserves the original first-pass rows and ownership hashes and
uses the same bounded backend gate. Confirmation proofs and all reassessment
outcomes are saved separately. `publication_queue.py` runs sequential batches on
tower; `publish_ready_batches.py` watches verified outputs from the Mac and
invokes the existing production driver. It records in-flight ownership before
writing and successful counts only after independent DB/search verification.
Do not manually apply a queued batch while its publisher holds `publish.lock`.

Freeze the first 100-row canary (20 per cluster), retain its proof and hash, then
run the ordinary dry run. Applying this early manifest additionally requires
`--preventive-batch` and `--verification verification-preventive.json`. The
manifest is limited to 1000 rows and each invocation to 100. This operational
process uses at most two DB connections, a 500 ms lock timeout and a five-second
statement timeout; assets are fetched before acquiring locks. No web server
restart, deployment, schema migration or asset deletion is needed.

Check receipts, DB/index agreement, normal search exclusion, direct URL access
and an unaffected control before advancing. Retain the exact early manifest and
revision markers so final reassessment can selectively restore cleared rows,
without overriding subsequent human edits.

## Apply later

Choose the existing moderator account whose ID should own the AGENT revisions.
Start with a 100-row canary; inspect receipts, search and direct URLs before
advancing to further batches. Final-corpus writes require their separate full
verification gate; the early rollout uses the explicit bounded mode above.

```bash
npm run corpus:audit -w backend -- \
  --manifest /path/hide-core-candidates.jsonl \
  --verification /path/verification-final.json \
  --expected-sha HASH_FROM_DRY_RUN --user-id MODERATOR_ID \
  --journal /path/apply-receipts.jsonl --offset 0 --limit 100 --apply
```

Before hiding each row, the command verifies the published audio SHA256 with a
45-second timeout and 25 MiB bound, outside the DB transaction. It then locks
the row and compares ID/public ID, original Japanese/English/Spanish, timings,
storage key, status and update timestamp. A changed source or independently
moderated row is left alone. Asset failures are recorded as conflicts; other
successfully applied rows still get indexed. No network fetch holds a row lock.

Each change saves only status and writes the previous snapshot as a new revision
in the same transaction. Revision metadata records manifest hash, model-policy
version, run ID, inventory signature and audio hash. This is the durable resume
record even if the process exits before writing its local receipt. Repeating an
exact batch does not create a duplicate revision or undo a later moderator edit.

After commits, fresh DB rows are indexed into Elasticsearch, refreshed, and their
indexed statuses compared with the DB. A successful batch prints
`search_verified`. A sync failure exits nonzero; rerun the same offset/hash to
repair committed changes before advancing. The existing subscriber may also
schedule indexing; success here does not depend on its queue request succeeding.
Search result counts/statistics can retain their existing application cache TTL;
the verification checks the actual indexed statuses used by search filters.

Increase `--offset` using `next_offset` only after the batch has succeeded, and
keep the same manifest bytes. Limits are 1–1000. Receipts list each changed,
already applied, skipped or conflicting ID. A conflict exits nonzero after
indexing successful changes; inspect it rather than treating the batch as fully
applied. This is a resumable series of per-row transactions, not one atomic
corpus-wide transaction.

## Roll back visibility later

Use the same manifest/hash and verification, adding `--rollback`. Without
`--apply` this is a read-only preview. With `--apply`, only rows actually hidden
by that manifest are eligible, and only if no later revision or source edit has
superseded the audit. The rollback restores ACTIVE status and creates a new
revision; it does not restore old text or timings. Before a new restoration,
the prepared command also checks the current published audio hash before taking
the row lock. Changed or unavailable audio is recorded as `audio_unverified` and
left unchanged. Repeating an already committed hide or restoration repairs the
index without fetching audio again. This updated restoration command must be
installed before final reconciliation; the ongoing preventive publisher retains
its existing deployed CLI while it runs. Index sync and verification
run again. Repeating a rollback is idempotent; applying the same manifest after
rolling it back will not hide it again.

```bash
npm run corpus:audit -w backend -- \
  --manifest /path/hide-core-candidates.jsonl --rollback --offset 0 --limit 100
```

The prepared restoration CLI also accepts `--offsets 0,3,8` to combine scattered
original offsets in one bounded invocation. This requires `--rollback`, excludes
a nonzero `--offset`, and rejects duplicate, descending, out-of-range or excess
offsets. The entire original manifest is still parsed and hashed; do not create
a filtered manifest. Offsets refer to the original manifest sorted by numeric ID.
The source, live audio, revision ownership and search checks are unchanged.
For the preventive operation, pack at most 100 original offsets per invocation.
The sparse-selection version is prepared and integration-tested, not installed
in the live publisher. Its immutable source and validation record are saved as
`restoration-applyCorpusAudit-v2.ts` and `restoration-sparse-validation.json` in
the audit workspace's `data/preventive-20261009-operation/`.

Retain the manifest and all receipts for later selective reconciliation. A
subsequent audit with different evidence is a new manifest and operation, not a
mutation of the previous history.

After the full reassessment verifier and `reconcile_preventive.py` produce a
verified restoration plan, execute only its rollback ranges, or pack exactly
those original offsets into bounded `--offsets` selections, using each original
publication manifest and hash. Never include a retained flag in the selection.
Then independently verify **every** original row,
including retained flags, with the read-only reconciliation verifier:

```bash
node --env-file-if-exists=.env --import tsx bin/verifyCorpusAuditReconciliation.ts \
  --plan /path/preventive-restoration-plan.json --expected-plan-sha PLAN_SHA256 \
  --verification /path/verification-reassessment.json --batch canary \
  --manifest /path/original-canary/hide-core-candidates.jsonl \
  --output /path/canary-reconciliation-verification.json
```

Repeat for every publication batch. This refuses incomplete reassessment proofs,
changed plan/manifest hashes, omitted IDs and a planned restoration with no actual
rollback revision. It checks unchanged source, exact audit evidence ownership,
current DB/index status and the normal ACTIVE search filter. Later edits, changed
sources, deletions or independent status changes are recorded as protected
conflicts. A proof with protected restore targets explicitly reports
`all_planned_restores_completed: false`; do not call those rows restored or silently
overwrite them. The verifier never writes DB rows or Elasticsearch documents.

For an owned, unchanged-source restore target still HIDDEN without a rollback
revision, the verifier independently fetches and hashes its current audio outside
the DB transaction. A different audio hash records a protected `audio_changed`
conflict, including both hashes, and leaves the segment untouched. Matching audio
still fails as a missing restoration; unavailable audio fails verification rather
than producing a successful proof. The fetch retains the 45-second and 25 MiB
bounds used by the apply command.

The read-only verifier and its helper were installed in the current production
backend container on 2026-10-09. Their deployed hashes match the prepared source;
the missing-argument gate and rejection of the actual partial 1.21-million
first-pass proof both passed before database initialization. Evidence is saved in
`nadeshiko-corpus-audit/data/preventive-20261009-operation/reconciliation-verifier/`.
The active apply CLI and services remained byte-identical, and no application
restart or visibility write occurred. Installation is preparation only: full
reassessment, the updated restoration CLI, actual rollback and per-batch final
verification are still required. A future container replacement requires checking
these files again.

The changed-audio verifier update was installed on 2026-10-10 after 18 targeted
tests passed against isolated Postgres and Elasticsearch, including the real
CLI's changed, matching and unavailable audio paths. Its deployed source hashes,
missing-argument gate, and rejection of the actual partial 1.26-million first-pass
proof are recorded under `reconciliation-verifier-v2/` in the operation directory.
The production apply command and running services remained unchanged. This does
not replace full reassessment, actual restoration, or final per-batch proofs.

## Verification

The integration tests exercise dry-run immutability, duplicate-free resume,
status-only rollback, source/status conflicts and later human revisions against
Postgres. An end-to-end service test indexes the row, hides it, verifies normal
search excludes it while direct GET returns 200/HIDDEN, then restores it and
verifies search returns it again.

```bash
npm test -w backend -- tests/services/corpus/auditManifest.test.ts tests/services/corpus/applyAudit.test.ts tests/services/corpus/verifyReconciliation.test.ts
npm run typecheck:app -w backend
npm run typecheck:tests -w backend
```
