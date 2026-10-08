import '@config/boot';
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { In } from 'typeorm';
import { AppDataSource } from '@config/database';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { Segment } from '@app/models/Segment';
import { SegmentRevision } from '@app/models/SegmentRevision';
import { parseAuditManifest, manifestHash } from '@app/services/corpus/auditManifest';
import { MissingAuditRestorationError, verifyReconciledCandidate } from '@app/services/corpus/verifyReconciliation';
import { getSegmentAudioUrl } from '@lib/utils/storage';

async function liveAudioHash(segment: Segment): Promise<string> {
  const response = await fetch(getSegmentAudioUrl(segment), { signal: AbortSignal.timeout(45_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Audio fetch failed:${segment.id}:${response.status}`);
  const sha = createHash('sha256');
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 25 * 1024 * 1024) throw new Error(`Audio exceeds 25 MiB:${segment.id}`);
      sha.update(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return sha.digest('hex');
}

interface PlanBatch {
  name: string;
  manifest_sha256: string;
  original_count: number;
  restore_ids: number[];
  retain: { id: number; action: string }[];
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string' },
      'expected-plan-sha': { type: 'string' },
      verification: { type: 'string' },
      batch: { type: 'string' },
      manifest: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (
    !values.plan ||
    !values['expected-plan-sha'] ||
    !values.verification ||
    !values.batch ||
    !values.manifest ||
    !values.output
  )
    throw new Error('plan, expected-plan-sha, verification, batch, manifest and output are required');
  const planBytes = await readFile(values.plan);
  if (manifestHash(planBytes) !== values['expected-plan-sha']) throw new Error('Restoration plan hash mismatch');
  const plan = JSON.parse(planBytes.toString('utf8'));
  const verification = JSON.parse(await readFile(values.verification, 'utf8'));
  if (
    plan.stage !== 'preventive-restoration-plan' ||
    plan.complete !== true ||
    plan.production_writes !== false ||
    verification.complete !== true ||
    verification.segments !== verification.catalog_total ||
    plan.full_catalog_verified !== verification.catalog_total ||
    verification.catalog_total < 1 ||
    JSON.stringify(plan.final_manifest_sha256) !== JSON.stringify(verification.manifest_sha256)
  )
    throw new Error('Full reassessment and restoration plan verification required');
  const batches = plan.batches as PlanBatch[];
  const batch = batches.find((b) => b.name === values.batch);
  if (!batch || batches.filter((b) => b.name === values.batch).length !== 1) throw new Error('Unknown/duplicate batch');
  const bytes = await readFile(values.manifest),
    sha = manifestHash(bytes);
  const rows = parseAuditManifest(bytes.toString('utf8'));
  const ids = rows.map((r) => r.id),
    restore = new Set(batch.restore_ids);
  const intended = [...batch.restore_ids, ...batch.retain.map((r) => r.id)];
  if (
    sha !== batch.manifest_sha256 ||
    rows.length !== batch.original_count ||
    intended.length !== rows.length ||
    new Set(intended).size !== rows.length ||
    intended.some((id) => !ids.includes(id)) ||
    batch.retain.some((r) => !['REVIEW', 'HIDE'].includes(r.action))
  )
    throw new Error('Plan does not cover the exact original publication manifest');
  AppDataSource.setOptions({
    extra: {
      ...AppDataSource.options.extra,
      max: 2,
      min: 0,
      statement_timeout: 5000,
      lock_timeout: 500,
      application_name: 'corpus-audit-reconciliation-verifier',
    },
  });
  await AppDataSource.initialize();
  try {
    const snapshot = await AppDataSource.transaction(async (manager) => {
      await manager.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const segments = await manager.find(Segment, { where: { id: In(ids) } });
      const revisions = await manager.find(SegmentRevision, { where: { segmentId: In(ids) } });
      return { segments, revisions };
    });
    const outcomes = [];
    for (const row of rows) {
      const segment = snapshot.segments.find((s) => s.id === row.id) ?? null;
      const revisions = snapshot.revisions.filter((r) => r.segmentId === row.id);
      try {
        outcomes.push(verifyReconciledCandidate(segment, revisions, row, sha, restore.has(row.id)));
      } catch (error) {
        if (!(error instanceof MissingAuditRestorationError) || !segment) throw error;
        // Independently inspect an un-restored asset outside the DB transaction.
        // Matching or unavailable audio still fails; only a proven content change
        // accounts for an intentionally protected restore target.
        const currentAudioSha = await liveAudioHash(segment);
        outcomes.push({
          ...verifyReconciledCandidate(segment, revisions, row, sha, true, currentAudioSha),
          audio_checked_at: new Date().toISOString(),
        });
      }
    }
    const statuses = new Map(outcomes.map((r) => [String(r.id), r.status]));
    const documents = await client.mget<{ status: string }>({ index: INDEX_NAME, ids: ids.map(String) });
    if (
      documents.docs.length !== ids.length ||
      new Set(documents.docs.map((doc) => doc._id)).size !== ids.length ||
      documents.docs.some((doc) => {
        const status = statuses.get(doc._id);
        if (status === undefined) return true;
        if (status === null) return !('found' in doc) || doc.found;
        return !('found' in doc) || !doc.found || doc._source?.status !== status;
      })
    )
      throw new Error('Current DB/search visibility mismatch');
    const active = await client.count({
      index: INDEX_NAME,
      query: { bool: { filter: [{ ids: { values: ids.map(String) } }, { term: { status: 'ACTIVE' } }] } },
    });
    if (active.count !== outcomes.filter((r) => r.status === 'ACTIVE').length)
      throw new Error('Normal ACTIVE search filter differs from current DB status');
    const protectedRows = outcomes.filter((r) => r.disposition === 'protected');
    const proof = {
      stage: 'production-preventive-reconciliation-verification',
      plan_sha256: values['expected-plan-sha'],
      manifest_sha256: sha,
      batch: batch.name,
      full_catalog_verified: verification.catalog_total,
      published_rows_accounted: outcomes.length,
      restored: outcomes.filter((r) => r.disposition === 'restored').length,
      retained: outcomes.filter((r) => r.disposition === 'retained').length,
      protected: protectedRows.length,
      protected_rows: protectedRows,
      outcomes,
      index_statuses_matched: documents.docs.length,
      normal_active_search_hits: active.count,
      all_planned_restores_completed: protectedRows.every((r) => r.intended !== 'restore'),
      production_writes: false,
      verified_at: new Date().toISOString(),
    };
    await writeFile(values.output, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(JSON.stringify({ ...proof, outcomes: undefined }));
  } finally {
    await AppDataSource.destroy();
    await client.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
