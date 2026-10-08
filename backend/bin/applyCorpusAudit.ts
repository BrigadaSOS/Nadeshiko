import '@config/boot';
import { parseArgs } from 'node:util';
import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AppDataSource } from '@config/database';
import { client, INDEX_NAME } from '@config/elasticsearch';
import { Segment } from '@app/models/Segment';
import { User } from '@app/models/User';
import { In } from 'typeorm';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import { getSegmentAudioUrl } from '@lib/utils/storage';
import {
  parseAuditManifest,
  manifestHash,
  validateFinalVerification,
  validatePreventiveVerification,
} from '@app/services/corpus/auditManifest';
import { applyAuditCandidate, matchesAuditSource } from '@app/services/corpus/applyAudit';

const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    verification: { type: 'string' },
    'expected-sha': { type: 'string' },
    apply: { type: 'boolean', default: false },
    rollback: { type: 'boolean', default: false },
    'preventive-batch': { type: 'boolean', default: false },
    'user-id': { type: 'string' },
    journal: { type: 'string' },
    limit: { type: 'string', default: '100' },
    offset: { type: 'string', default: '0' },
    offsets: { type: 'string' },
  },
});

async function checkAudio(segment: Segment, expected: string): Promise<void> {
  const response = await fetch(getSegmentAudioUrl(segment), { signal: AbortSignal.timeout(45_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Audio fetch failed: ${response.status}`);
  const sha = createHash('sha256');
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 25 * 1024 * 1024) throw new Error('Audio exceeds 25 MiB');
      sha.update(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (sha.digest('hex') !== expected) throw new Error('Published audio changed since audit');
}

async function main(): Promise<void> {
  if (!values.manifest) throw new Error('--manifest is required');
  const bytes = await readFile(values.manifest);
  const sha = manifestHash(bytes);
  const rows = parseAuditManifest(bytes.toString('utf8'));
  const limit = Number(values.limit),
    offset = Number(values.offset),
    userId = Number(values['user-id'] ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0)
    throw new Error('limit must be 1..1000; offset must be nonnegative');
  let selectedOffsets: number[] | undefined;
  if (values.offsets !== undefined) {
    if (!values.rollback || offset !== 0)
      throw new Error('--offsets requires --rollback and cannot combine with --offset');
    if (!/^\d+(,\d+)*$/.test(values.offsets))
      throw new Error('--offsets must be comma-separated original manifest offsets');
    selectedOffsets = values.offsets.split(',').map(Number);
    if (
      selectedOffsets.length > limit ||
      selectedOffsets.some(
        (value, index) =>
          !Number.isSafeInteger(value) || value >= rows.length || (index > 0 && value <= selectedOffsets![index - 1]!),
      )
    )
      throw new Error(
        '--offsets must be unique, strictly increasing, within the original manifest and bounded by --limit',
      );
  }
  const selected = selectedOffsets ? selectedOffsets.map((value) => rows[value]!) : rows.slice(offset, offset + limit);
  if (values.apply) {
    if (
      values['expected-sha'] !== sha ||
      !values.verification ||
      !values.journal ||
      !Number.isSafeInteger(userId) ||
      userId < 1
    ) {
      throw new Error('Writes require --expected-sha, --verification, --journal and --user-id');
    }
    const verification = JSON.parse(await readFile(values.verification, 'utf8'));
    if (values['preventive-batch']) {
      if (limit > 100) throw new Error('Preventive batches are limited to 100 rows per invocation');
      validatePreventiveVerification(verification, sha, rows);
    } else {
      validateFinalVerification(verification, sha);
    }
    // Fail before any DB write if the local receipt cannot be opened.
    await appendFile(values.journal, '');
  }
  console.log(
    JSON.stringify({
      mode: values.apply ? 'apply' : 'dry-run',
      rollback: values.rollback,
      manifest_sha256: sha,
      total: rows.length,
      offset,
      selected: selected.length,
      next_offset: selectedOffsets ? null : offset + selected.length,
      selected_offsets: selectedOffsets,
    }),
  );
  // This operational process uses a small pool and does not wait long on a user edit.
  AppDataSource.setOptions({
    extra: {
      ...AppDataSource.options.extra,
      max: 2,
      min: 0,
      lock_timeout: 500,
      statement_timeout: 5000,
      idle_in_transaction_session_timeout: 5000,
      application_name: 'nadeshiko-corpus-audit',
    },
  });
  await AppDataSource.initialize();
  try {
    if (values.apply && !(await User.existsBy({ id: userId }))) throw new Error('Actor user does not exist');
    const outcomes = [];
    for (const row of selected) {
      // Download before acquiring the row lock; then recheck DB source under the lock.
      if (values.apply) {
        const preview = await AppDataSource.transaction(async (manager) => {
          await manager.query('SET TRANSACTION READ ONLY');
          return applyAuditCandidate(manager, row, {
            manifestSha: sha,
            write: false,
            rollback: values.rollback,
            userId,
          });
        });
        // A committed status change only needs search repair. Check current audio
        // before a new hide or restoration, without blocking idempotent repair.
        const segment = ['would_hidden', 'would_restored'].includes(preview.outcome)
          ? await Segment.findOneBy({ id: row.id })
          : null;
        if (segment && matchesAuditSource(segment, row)) {
          try {
            await checkAudio(segment, row.audio_sha256);
          } catch (error) {
            const result = {
              id: row.id,
              outcome: 'audio_unverified',
              error: error instanceof Error ? error.message : String(error),
            };
            outcomes.push(result);
            const receipt = JSON.stringify({
              ...result,
              public_id: row.public_id,
              manifest_sha256: sha,
              at: new Date().toISOString(),
            });
            if (values.journal) await appendFile(values.journal, `${receipt}\n`);
            console.log(receipt);
            continue;
          }
        }
      }
      const result = await AppDataSource.transaction(async (manager) => {
        if (!values.apply) await manager.query('SET TRANSACTION READ ONLY');
        return applyAuditCandidate(manager, row, {
          manifestSha: sha,
          write: values.apply,
          rollback: values.rollback,
          userId,
          preventive: values['preventive-batch'],
        });
      });
      outcomes.push(result);
      const receipt = JSON.stringify({
        ...result,
        public_id: row.public_id,
        manifest_sha256: sha,
        at: new Date().toISOString(),
      });
      if (values.apply && values.journal) await appendFile(values.journal, `${receipt}\n`);
      console.log(receipt);
    }
    // Fresh committed rows: this also repairs a previous run interrupted after DB commit.
    const syncIds = outcomes.filter((result) => 'sync' in result && result.sync).map((result) => result.id);
    if (values.apply && syncIds.length) {
      const segments = await Segment.find({ where: { id: In(syncIds) } });
      const indexed = await SegmentIndexer.bulkIndex(segments);
      if (indexed.failed || segments.length !== syncIds.length)
        throw new Error('ES synchronization incomplete; rerun this exact batch to repair');
      await client.indices.refresh({ index: INDEX_NAME });
      const documents = await client.mget<{ status: string }>({ index: INDEX_NAME, ids: syncIds.map(String) });
      const statuses = new Map(segments.map((segment) => [String(segment.id), segment.status]));
      if (
        documents.docs.some((doc) => !('found' in doc) || !doc.found || doc._source?.status !== statuses.get(doc._id))
      ) {
        throw new Error('DB/ES status verification failed; rerun this exact batch to repair');
      }
      const receipt = JSON.stringify({
        stage: 'search_verified',
        manifest_sha256: sha,
        ids: syncIds,
        at: new Date().toISOString(),
      });
      if (values.journal) await appendFile(values.journal, `${receipt}\n`);
      console.log(receipt);
    }
    const conflicts = outcomes.filter(
      (result) =>
        ![
          'hidden',
          'restored',
          'would_hidden',
          'would_restored',
          'already_applied',
          'already_rolled_back',
          'not_applied',
        ].includes(result.outcome),
    );
    if (conflicts.length)
      throw new Error(`${conflicts.length} source/status conflicts retained; inspect receipts before continuing`);
  } finally {
    await AppDataSource.destroy();
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
