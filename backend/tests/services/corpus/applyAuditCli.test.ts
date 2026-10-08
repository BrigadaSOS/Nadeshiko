import { beforeAll, afterAll, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeepPartial } from 'typeorm';
import { TestDataSource } from '../../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../../fixtures/core';
import { loadFixtures } from '../../fixtures/loader';
import { Segment, SegmentStatus, SegmentStorage, ContentRating } from '@app/models/Segment';
import { SegmentRevision } from '@app/models/SegmentRevision';
import { Media } from '@app/models/Media';
import { Episode } from '@app/models/Episode';
import { applyAuditCandidate, audioKey } from '@app/services/corpus/applyAudit';
import type { AuditCandidate } from '@app/services/corpus/auditManifest';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import { client, INDEX_NAME } from '@config/elasticsearch';

// A child CLI needs committed fixtures. Only this test's rows are deleted below.
let core: CoreFixtures;
let segment: Segment;
let row: AuditCandidate;
beforeAll(async () => {
  await TestDataSource.initialize();
  core = await seedCoreFixtures();
});
afterAll(async () => {
  await TestDataSource.destroy();
  await client.close();
});

it('CLI protects and verifies changed audio, restores selected offsets and repairs restored rows without fetching audio', async () => {
  const fixtures = await loadFixtures(['mediaWithEpisode']);
  const segments = (await Segment.save(
    [1, 2, 3].map<DeepPartial<Segment>>((counter) => ({
      uuid: `audit-${counter}`,
      publicId: `aud${String(counter).padStart(9, '0')}`,
      mediaId: fixtures.media.testShow!.id,
      episode: 1,
      position: counter,
      status: SegmentStatus.ACTIVE,
      startTimeMs: 100,
      endTimeMs: 1000,
      contentJa: '日本語',
      contentEn: 'Japanese',
      contentEs: 'Japonés',
      contentEnMt: false,
      contentEsMt: false,
      contentRating: ContentRating.SAFE,
      ratingAnalysis: { scores: {}, tags: {} },
      storage: SegmentStorage.R2,
      storageBasePath: 'media/1',
      hashedId: 'test',
      tokens: null,
    })),
  )) as Segment[];
  segment = segments[0]!;
  row = {
    id: segment.id,
    public_id: segment.publicId,
    action: 'HIDE',
    desired_status: 'HIDDEN',
    previous_status: 'ACTIVE',
    updated_at: segment.updatedAt?.toISOString() ?? null,
    audio_key: audioKey(segment),
    audio_sha256: 'a'.repeat(64),
    inventory_signature: 'b'.repeat(64),
    policy: 'automatic-core-v3',
    run_id: 'test',
    reasons: ['JA_AUDIO_MISMATCH'],
    original: { ja: segment.contentJa, en: segment.contentEn, es: segment.contentEs, start_ms: 100, end_ms: 1000 },
    quality: {
      core: { decision: 'HIDE', affects_visibility: true, reasons: ['JA_AUDIO_MISMATCH'] },
      spanish: { affects_visibility: false },
    },
  };
  const folder = await mkdtemp(join(tmpdir(), 'nadeshiko-audit-restore-'));
  const audio = 'original test audio';
  row.audio_sha256 = createHash('sha256').update(audio).digest('hex');
  const candidates = segments.map((current) => ({
    ...row,
    id: current.id,
    public_id: current.publicId,
    updated_at: current.updatedAt?.toISOString() ?? null,
    audio_key: audioKey(current),
  }));
  // Original offsets refer to the entire manifest sorted by ID, regardless of file order.
  const manifest = candidates
    .toReversed()
    .map((candidate) => `${JSON.stringify(candidate)}\n`)
    .join('');
  const sha = createHash('sha256').update(manifest).digest('hex');
  const manifestPath = join(folder, 'manifest.jsonl');
  const verificationPath = join(folder, 'verification.json');
  const journal = join(folder, 'receipts.jsonl');
  const preload = join(folder, 'test-audio.mjs');
  try {
    await writeFile(manifestPath, manifest);
    await writeFile(
      verificationPath,
      JSON.stringify({
        stage: 'final',
        complete: true,
        verified_segments: 3,
        catalog_total: 3,
        production_changed: false,
        manifest_sha256: { 'hide-core-candidates.jsonl': sha },
      }),
    );
    await writeFile(
      preload,
      `globalThis.fetch = async () => {
          if (process.env.AUDIT_TEST_AUDIO === 'unavailable') throw new Error('test audio unavailable');
          return new Response(process.env.AUDIT_TEST_AUDIO === 'matching' ? ${JSON.stringify(audio)} : 'changed test audio');
        };`,
    );
    for (const candidate of candidates)
      expect(
        (
          await TestDataSource.transaction((manager) =>
            applyAuditCandidate(manager, candidate, {
              manifestSha: sha,
              write: true,
              rollback: false,
              userId: core.users.kevin.id,
            }),
          )
        ).outcome,
      ).toBe('hidden');
    for (const current of segments)
      expect(await SegmentIndexer.index(await Segment.findOneByOrFail({ id: current.id }))).toBe(true);
    await client.indices.refresh({ index: INDEX_NAME });
    const invoke = (mode: string, offsets?: string, extra: string[] = []) =>
      new Promise<{ status: number | string; stdout: string; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            '--import',
            'tsx',
            '--import',
            preload,
            'bin/applyCorpusAudit.ts',
            '--manifest',
            manifestPath,
            '--verification',
            verificationPath,
            '--expected-sha',
            sha,
            '--user-id',
            String(core.users.kevin.id),
            '--journal',
            journal,
            '--rollback',
            '--apply',
            '--limit',
            offsets === undefined ? '1' : '2',
            ...(offsets === undefined ? [] : ['--offsets', offsets]),
            ...extra,
          ],
          { env: { ...process.env, AUDIT_TEST_AUDIO: mode }, timeout: 20_000 },
          (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr }),
        );
      });
    const changed = await invoke('changed');
    expect(changed.status, changed.stderr).toBe(1);
    expect(changed.stdout).toContain('audio_unverified');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('HIDDEN');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(1);

    const finalHashes = { 'hide-core-candidates.jsonl': 'd'.repeat(64) };
    const planPath = join(folder, 'restoration-plan.json');
    const reassessmentPath = join(folder, 'reassessment-verification.json');
    const reconciliationPath = join(folder, 'reconciliation-proof.json');
    const planBytes = JSON.stringify({
      stage: 'preventive-restoration-plan',
      complete: true,
      production_writes: false,
      full_catalog_verified: 3,
      final_manifest_sha256: finalHashes,
      batches: [
        {
          name: 'test',
          manifest_sha256: sha,
          original_count: 3,
          restore_ids: [segment.id],
          retain: candidates.slice(1).map((candidate) => ({ id: candidate.id, action: 'HIDE' })),
        },
      ],
    });
    await writeFile(planPath, planBytes);
    await writeFile(
      reassessmentPath,
      JSON.stringify({
        complete: true,
        catalog_total: 3,
        segments: 3,
        manifest_sha256: finalHashes,
      }),
    );
    const verify = async (mode: string) => {
      await rm(reconciliationPath, { force: true });
      return new Promise<{ status: number | string; stdout: string; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            '--import',
            'tsx',
            '--import',
            preload,
            'bin/verifyCorpusAuditReconciliation.ts',
            '--plan',
            planPath,
            '--expected-plan-sha',
            createHash('sha256').update(planBytes).digest('hex'),
            '--verification',
            reassessmentPath,
            '--batch',
            'test',
            '--manifest',
            manifestPath,
            '--output',
            reconciliationPath,
          ],
          { env: { ...process.env, AUDIT_TEST_AUDIO: mode }, timeout: 20_000 },
          (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr }),
        );
      });
    };
    const changedProof = await verify('changed');
    expect(changedProof.status, changedProof.stderr).toBe(0);
    const protectedProof = JSON.parse(await readFile(reconciliationPath, 'utf8'));
    expect(protectedProof).toMatchObject({
      published_rows_accounted: 3,
      restored: 0,
      retained: 2,
      protected: 1,
      index_statuses_matched: 3,
      normal_active_search_hits: 0,
      all_planned_restores_completed: false,
      production_writes: false,
    });
    expect(protectedProof.protected_rows[0]).toMatchObject({
      id: segment.id,
      reason: 'audio_changed',
      intended: 'restore',
      status: 'HIDDEN',
      expected_audio_sha256: row.audio_sha256,
      current_audio_sha256: createHash('sha256').update('changed test audio').digest('hex'),
    });
    expect(protectedProof.protected_rows[0].audio_checked_at).toBeTruthy();
    for (const mode of ['matching', 'unavailable']) {
      const failedProof = await verify(mode);
      expect(failedProof.status, failedProof.stderr).toBe(1);
      await expect(readFile(reconciliationPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('HIDDEN');
      expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(1);
    }

    for (const offsets of ['0,0', '2,0', '0,3', '0,1,2', '0,-1', '']) {
      const invalid = await invoke('matching', offsets);
      expect(invalid.status, invalid.stderr).toBe(1);
      expect(invalid.stdout).not.toContain('"outcome":');
      for (const current of segments) {
        expect((await Segment.findOneByOrFail({ id: current.id })).status).toBe('HIDDEN');
        expect(await SegmentRevision.countBy({ segmentId: current.id })).toBe(1);
      }
    }
    const mixed = await invoke('matching', '0,2', ['--offset', '1']);
    expect(mixed.status, mixed.stderr).toBe(1);
    expect(mixed.stdout).not.toContain('"outcome":');

    const matching = await invoke('matching', '0,2');
    expect(matching.status, matching.stderr).toBe(0);
    expect(matching.stdout).toContain('"outcome":"restored"');
    expect(matching.stdout).toContain('search_verified');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('ACTIVE');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(2);
    expect((await Segment.findOneByOrFail({ id: segments[1]!.id })).status).toBe('HIDDEN');
    expect(await SegmentRevision.countBy({ segmentId: segments[1]!.id })).toBe(1);
    expect((await Segment.findOneByOrFail({ id: segments[2]!.id })).status).toBe('ACTIVE');
    expect(await SegmentRevision.countBy({ segmentId: segments[2]!.id })).toBe(2);
    const receipts = matching.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    expect(receipts.find((receipt) => receipt.stage === 'search_verified').ids).toEqual([
      segments[0]!.id,
      segments[2]!.id,
    ]);
    expect(receipts.find((receipt) => receipt.mode === 'apply').selected_offsets).toEqual([0, 2]);

    const repair = await invoke('unavailable', '0,2');
    expect(repair.status, repair.stderr).toBe(0);
    expect(repair.stdout).toContain('already_rolled_back');
    expect(repair.stdout).toContain('search_verified');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(2);
    expect(await SegmentRevision.countBy({ segmentId: segments[2]!.id })).toBe(2);
    expect((await Segment.findOneByOrFail({ id: segments[1]!.id })).status).toBe('HIDDEN');
    expect(await SegmentRevision.countBy({ segmentId: segments[1]!.id })).toBe(1);
  } finally {
    for (const current of segments) {
      await client.delete({ index: INDEX_NAME, id: String(current.id) }, { ignore: [404] });
      await SegmentRevision.delete({ segmentId: current.id });
      await Segment.delete({ id: current.id });
    }
    await Episode.delete({ mediaId: segment.mediaId });
    await Media.delete({ id: segment.mediaId });
    await rm(folder, { recursive: true, force: true });
  }
}, 240_000);
