import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestDataSource, setupTestSuite, createTestApp, signInAs } from '../../helpers/setup';
import { request } from '../../helpers/http';
import { seedCoreFixtures, type CoreFixtures } from '../../fixtures/core';
import { loadFixtures } from '../../fixtures/loader';
import { Segment, SegmentStatus, SegmentStorage, ContentRating } from '@app/models/Segment';
import { SegmentRevision, RevisionActor } from '@app/models/SegmentRevision';
import { setBossInstance } from '@app/workers/pgBossClient';
import { applyAuditCandidate, audioKey } from '@app/services/corpus/applyAudit';
import { verifyReconciledCandidate } from '@app/services/corpus/verifyReconciliation';
import type { AuditCandidate } from '@app/services/corpus/auditManifest';
import { SegmentIndexer } from '@app/services/search/segmentDocument/SegmentIndexer';
import { SegmentDocument } from '@app/services/search/SegmentDocument';
import { client, INDEX_NAME } from '@config/elasticsearch';

setupTestSuite();
const app = createTestApp();
let core: CoreFixtures;
let segment: Segment;
let row: AuditCandidate;
let counter = 0;
beforeAll(async () => {
  core = await seedCoreFixtures();
  setBossInstance({ sendDebounced: vi.fn(async () => 'job') } as never);
});
beforeEach(async () => {
  counter += 1;
  const fixtures = await loadFixtures(['mediaWithEpisode']);
  segment = (await Segment.save({
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
  })) as Segment;
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
});

const options = () => ({ manifestSha: 'c'.repeat(64), write: true, rollback: false, userId: core.users.kevin.id });
const apply = (override = {}) => applyAuditCandidate(TestDataSource.manager, row, { ...options(), ...override });

describe('corpus audit application', () => {
  it('dry run writes neither status nor revisions', async () => {
    expect((await apply({ write: false })).outcome).toBe('would_hidden');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('ACTIVE');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(0);
  });

  it('hides once, preserves text, and resumes without duplicate revisions', async () => {
    expect((await apply()).outcome).toBe('hidden');
    expect((await apply()).outcome).toBe('already_applied');
    const current = await Segment.findOneByOrFail({ id: segment.id });
    expect(current.status).toBe('HIDDEN');
    expect(current.contentJa).toBe(row.original.ja);
    const revisions = await SegmentRevision.findBy({ segmentId: segment.id });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.snapshot.status).toBe('ACTIVE');
    expect(revisions[0]!.snapshot.corpusAudit).toMatchObject({ manifestSha: options().manifestSha, phase: 'hide' });
    expect(revisions[0]!.actor).toBe('AGENT');
    expect(verifyReconciledCandidate(current, revisions, row, options().manifestSha, false).disposition).toBe(
      'retained',
    );
  });

  it('rolls back status only and records an undoable new revision', async () => {
    await apply();
    expect((await apply({ rollback: true })).outcome).toBe('restored');
    expect((await apply({ rollback: true })).outcome).toBe('already_rolled_back');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('ACTIVE');
    const revisions = await SegmentRevision.find({
      where: { segmentId: segment.id },
      order: { revisionNumber: 'ASC' },
    });
    expect(revisions.map((revision) => revision.snapshot.status)).toEqual(['ACTIVE', 'HIDDEN']);
    expect((await apply()).outcome).toBe('already_rolled_back');
    expect(
      verifyReconciledCandidate(
        await Segment.findOneByOrFail({ id: segment.id }),
        revisions,
        row,
        options().manifestSha,
        true,
      ).disposition,
    ).toBe('restored');
  });

  it('refuses changed source and independently moderated status', async () => {
    row.original.en = 'changed';
    expect((await apply()).outcome).toBe('source_changed');
    row.original.en = segment.contentEn;
    segment.status = SegmentStatus.HIDDEN;
    await Segment.save(segment);
    expect((await apply()).outcome).toBe('status_changed');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(0);
  });

  it('refuses rollback after a later human revision even when the text matches', async () => {
    await apply();
    await SegmentRevision.save({
      segmentId: segment.id,
      revisionNumber: 2,
      snapshot: {},
      userId: core.users.kevin.id,
      actor: RevisionActor.HUMAN,
      reportId: null,
    });
    expect((await apply({ rollback: true })).outcome).toBe('edited_after_audit');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('HIDDEN');
    expect(
      verifyReconciledCandidate(
        await Segment.findOneByOrFail({ id: segment.id }),
        await SegmentRevision.findBy({ segmentId: segment.id }),
        row,
        options().manifestSha,
        true,
      ),
    ).toMatchObject({ disposition: 'protected', reason: 'edited_after_audit' });
  });

  it('does not restore segments this run never hid', async () => {
    expect((await apply({ rollback: true })).outcome).toBe('not_applied');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(0);
  });

  it('requires explicit preventive mode and strong evidence for a first-pass hide', async () => {
    row.policy = 'first-pass-core-v3';
    row.reviews = {
      primary: {
        model: 'gpt-6.1-sol',
        audio_ja: 'mismatch',
        en: 'compatible',
        issues: [{ check: 'audio_ja', confidence: 'high', ja_quote: '日本語', comparison_quote: '別の台詞' }],
      },
    };
    row.asr = { transcript: '別の台詞' };
    await expect(apply()).rejects.toThrow('Only final adjudicated');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('ACTIVE');
    row.reviews.primary.issues[0]!.confidence = 'medium';
    await expect(apply({ preventive: true })).rejects.toThrow('high-confidence core Hide');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(0);
    row.reviews.primary.issues[0]!.confidence = 'high';
    expect((await apply({ preventive: true })).outcome).toBe('hidden');
    expect((await apply({ preventive: true })).outcome).toBe('already_applied');
    expect((await apply({ preventive: true, rollback: true })).outcome).toBe('restored');
    expect((await Segment.findOneByOrFail({ id: segment.id })).status).toBe('ACTIVE');
  });

  it('keeps the direct URL accessible while removing the segment from normal search', async () => {
    signInAs(app, core.users.kevin);
    expect(await SegmentIndexer.index(segment)).toBe(true);
    await client.indices.refresh({ index: INDEX_NAME });
    const query = { take: 10, query: { search: '日本語', exactMatch: false } };
    expect(
      (await SegmentDocument.searchInIds([segment.id], query)).segments.map((result) => result.publicId),
    ).toContain(segment.publicId);
    await apply();
    expect(await SegmentIndexer.index(await Segment.findOneByOrFail({ id: segment.id }))).toBe(true);
    await client.indices.refresh({ index: INDEX_NAME });
    expect((await SegmentDocument.searchInIds([segment.id], query)).segments).toEqual([]);
    const response = await request(app).get(`/v1/media/segments/${segment.publicId}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      publicId: segment.publicId,
      status: 'HIDDEN',
      textJa: { content: row.original.ja },
    });
    await apply({ rollback: true });
    expect(await SegmentIndexer.index(await Segment.findOneByOrFail({ id: segment.id }))).toBe(true);
    await client.indices.refresh({ index: INDEX_NAME });
    expect(
      (await SegmentDocument.searchInIds([segment.id], query)).segments.map((result) => result.publicId),
    ).toContain(segment.publicId);
  });
});
