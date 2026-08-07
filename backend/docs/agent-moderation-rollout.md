# Agent moderation rollout

Nadeshiko's user-report queue is now worked by an external agent (Hermes/roxy on
QTower) rather than by a person or by the in-app audit runner. This document
covers what shipped, what is verified on staging, and what is still unverified
going into prod.

Written mid-rollout: staging is deployed and checked, prod is not. Pick up at
[Remaining verification](#remaining-verification).

## What changed

**Removed** the media audit system — `MediaAudit` / `MediaAuditRun`, the runner
and its checks, the boot initializer, five admin endpoints, and the admin UI tab.
It produced `AUTO` reports on a schedule and was never actually run in
production, so it had no remaining caller once moderation moved out of the app.

`ReportReason` keeps its `AUTO` codes (`DB_ES_SYNC_ISSUES` and friends) and
`ReportSource.AUTO` remains. Dropping a Postgres enum value means rewriting the
type and every column that uses it, and any AUTO rows still in the table
reference them.

**Added** the surface an external agent needs:

| Endpoint | Purpose |
|---|---|
| `POST /v1/media/segments/{id}/revisions/{n}/restore` | Undo any edit |
| `POST /v1/media/{m}/episodes/{n}/segments/moderate` | Episode-wide timing shift / status |
| `GET /v1/admin/agent-activity` | What the agent actually changed |
| `PATCH /v1/media/segments/{id}` (existing, extended) | Now accepts `reportId` |

Plus `SegmentRevision.actor` (`HUMAN` / `AGENT`) and `.reportId`, an admin UI at
`/user/admin/agent-activity` with a per-row diff and restore button, and
`npm run create:service-key` for minting the credential.

The agent side is `skills/nadeshiko-moderation/` in `davafons-infra`, wired into
`scripts/ensure-cron` as a 10:30 JST job.

### Migrations

| Migration | Effect |
|---|---|
| `DropMediaAudits1786100000000` | Drops `MediaAudit`, `MediaAuditRun`, `Report.audit_run_id` |
| `SegmentRevisionProvenance1786100100000` | Adds `SegmentRevision.actor` + `.report_id` |

Both round-trip (apply → rollback → re-apply) cleanly.

## Design decisions worth not re-litigating

**Bulk moderation writes entities, not a set-based `UPDATE`.** Elasticsearch
reindexing rides on the `afterUpdate` subscriber in
`app/subscribers/segmentSubscriber.ts`, which a query-builder update does not
fire. A bulk `UPDATE` would leave search serving stale timings for the whole
episode — exactly the defect the shift is fixing. The loop is slower on purpose.

**`maxAffected` is required and rejects the whole request.** A cap smaller than
the episode changes nothing rather than applying to the first N segments. A
caller that misjudged the scope leaves no half-shifted episode behind.

**Restore writes a new revision rather than rewinding the counter.** Restoring
revision 3 from revision 7 produces revision 8, whose snapshot holds what 7 left
behind. History stays append-only and the restore is itself undoable.

**`actor` is recorded at write time, not inferred later.** The agent
authenticates with a service key belonging to a real user row, so `userId` alone
cannot distinguish it from that person editing by hand. `resolveRevisionActor`
reads the key's *kind*, which is not recoverable after the fact.

**Service keys are minted by direct DB insert, not `auth.api.createApiKey`.**
The apiKey plugin runs with metadata disabled, and enabling it would be a real
hole: `/v1/auth/api-key/create` is reachable by any signed-in user, so with
metadata on, any of them could post `{metadata: {keyType: "service"}}` and mint a
key that skips the quota and rate limiter. Keep it disabled. Details in the
header of `bin/createServiceKey.ts`.

## Staging status — verified 2026-08-07

Deployed manually (CI's deploy step could not SSH; the host was offline in the
tailnet at the time).

| Check | Result |
|---|---|
| `GET /up` | 200 |
| Migrations | Both executed 02:07:40, confirmed in logs |
| New routes | All three return 401 — registered, auth enforced |
| Removed audit routes | 404 |
| Errors since deploy | None. The 32 errors at 01:59 were a Postgres restart *before* the 02:07 deploy |
| Boots since | 3 clean (02:13, 03:20, 03:24) |
| Frontend | 200 |

The brief window where report endpoints can 500 during a deploy — old container
still serving with `Report.audit_run_id` mapped while the new one migrates — did
not produce a single error on staging. Staging traffic is too low to hit it.
Prod has more traffic, so expect a handful of failed report submissions during
the cutover. Report endpoints only; search and media are untouched.

## Remaining verification

Nothing below has been done. All of it proves the moderation loop *works*, as
opposed to proving the code *deployed*.

### Not verifiable without a login

- **The admin UI.** Everything under `/user/admin/*` redirects to `/en` when
  signed out, including deliberately bogus paths, so an unauthenticated probe
  cannot tell "page exists" from "page doesn't". Sign in and open
  `/user/admin/agent-activity`.
- **The E2E suite never ran** — CI died at the deploy step, so the `e2e` job was
  skipped. Point it at an environment yourself:
  `cd frontend && E2E_BASE_URL=https://stg.nadeshiko.co npm run test:e2e`

### The end-to-end moderation check

Do this against whichever environment the agent will first run in. Step 3 is the
one that matters most.

1. Mint a service key for that environment:
   `npm run create:service-key -- --user <admin> --name roxy-moderation --permissions READ_MEDIA,UPDATE_MEDIA`
2. `PATCH` a segment with a `reportId`, using that key.
3. `GET /v1/admin/agent-activity` — confirm the edit appears, with the
   before/after pair and the report link.
4. `POST .../revisions/{n}/restore` — confirm the text reverts.
5. `POST .../segments/moderate` with `maxAffected: 1` against a multi-segment
   episode — confirm it **refuses** and changes nothing.

**Why step 3 is the critical one.** If the key were minted as a USER key by
mistake, every other step still passes: the edit lands, the restore works, the
cap holds. Only the activity feed would be silently and permanently empty — and
that feed is the entire basis of the human spot-check. This is the one failure
that hides itself.

**Why step 5 is second.** The cap is what stands between a bad agent run and a
rewritten episode, and it has never been exercised outside unit tests.

## Deploying to prod

1. Tag `vX.Y.Z` → prod deploy. Migrations run on container boot; a failed
   migration throws in `runInitializers` before `server.listen()`, so the deploy
   fails and the previous container keeps serving rather than a broken one taking
   traffic.
2. Expect the brief report-endpoint window described above.
3. Mint the prod service key. **Check first that `scripts/remote-db.sh` can run
   an arbitrary bin script** — it is built for `migrate`-style commands, and if
   it cannot, that is a one-line addition better made before you are standing at
   the prod prompt.
4. Store the key at `/davafons-infra/qtower/hermes/NADESHIKO_API_KEY` in SSM.
   `deploy.sh` aborts on a name it cannot resolve or a value that resolves empty.
5. `./deploy.sh qtower deploy hermes`
6. Run the end-to-end check above against prod.
7. First digest lands 10:30 JST in the BrigadaSOS Discord channel.

## After the first runs

**The caps in the skill are guesses.** 50 individual edits per run, 5
episode-wide actions, propose-rather-than-apply above 200 segments. They were
picked without reference to real queue volume. Watch the first week's digests and
tune them against what the queue actually contains.

**Spot-check deliberately.** Nothing samples the agent's work automatically.
Sampling a few entries at `/user/admin/agent-activity` after a run is the
intended human involvement, and it is the only thing that catches a
systematically wrong call before readers do.

**Trust the feed over the digest.** The digest is the agent's own account of a
run and shares that run's failure modes. `/v1/admin/agent-activity` reads back
the revisions actually written. When the two disagree, the disagreement is the
most useful signal available.

## Known gaps

- **Audio-dependent report reasons cannot be settled by the agent.**
  `WRONG_AUDIO`, `LOW_QUALITY_AUDIO`, and most `WRONG_JAPANESE_TEXT` need the
  audio, which the agent has no access to. They will accumulate as open reports.
  Closing that means an ASR pass, which is a separate system.
- **Anyone with the app DB role can write an `apikey` row** with arbitrary
  metadata, so DB access and key-minting authority are the same thing.
  Separating them means a DB-level grant change affecting `db:bootstrap` and
  better-auth's own key creation — its own piece of work, worth doing only if
  that separation is actually wanted.
- **The `davafons-infra` changes are uncommitted** as of writing (that repo had
  unrelated work in progress). The moderation skill, the cron entry, and the
  `.env.yaml` additions all need committing there before `deploy.sh` will pick
  them up.
