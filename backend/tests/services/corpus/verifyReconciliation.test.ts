import { describe, expect, it } from 'vitest';
import type { Segment } from '@app/models/Segment';
import { SegmentRevision } from '@app/models/SegmentRevision';
import type { AuditCandidate } from '@app/services/corpus/auditManifest';
import { MissingAuditRestorationError, verifyReconciledCandidate } from '@app/services/corpus/verifyReconciliation';

const sha = 'c'.repeat(64);
const segment = {
  id: 1,
  publicId: 'public',
  contentJa: '日本語',
  contentEn: 'Japanese',
  contentEs: 'Japonés',
  startTimeMs: 100,
  endTimeMs: 1000,
  storage: 'R2',
  storageBasePath: 'media/1',
  episode: 1,
  externalVideoId: null,
  hashedId: 'audio',
  status: 'HIDDEN',
} as Segment;
const row = {
  id: 1,
  public_id: 'public',
  original: { ja: '日本語', en: 'Japanese', es: 'Japonés', start_ms: 100, end_ms: 1000 },
  audio_key: 'media/1/1/audio.mp3',
  audio_sha256: 'a'.repeat(64),
  inventory_signature: 'b'.repeat(64),
  policy: 'first-pass-core-v3',
  run_id: 'run',
} as AuditCandidate;
function revision(phase: 'hide' | 'rollback'): SegmentRevision {
  const n = phase === 'hide' ? 1 : 2;
  return Object.assign(new SegmentRevision(), {
    id: n,
    segmentId: 1,
    revisionNumber: n,
    actor: 'AGENT',
    snapshot: {
      status: phase === 'hide' ? 'ACTIVE' : 'HIDDEN',
      corpusAudit: {
        manifestSha: sha,
        phase,
        audioSha: row.audio_sha256,
        inventorySignature: row.inventory_signature,
        policy: row.policy,
        runId: row.run_id,
      },
    },
  });
}
describe('independent visibility reconciliation proof', () => {
  it('proves retained hides and actual restores, irrespective of input history ordering', () => {
    expect(verifyReconciledCandidate(segment, [revision('hide')], row, sha, false).disposition).toBe('retained');
    expect(
      verifyReconciledCandidate(
        { ...segment, status: 'ACTIVE' } as Segment,
        [revision('hide'), revision('rollback')],
        row,
        sha,
        true,
      ).disposition,
    ).toBe('restored');
  });
  it('rejects an intended restore that was merely planned', () => {
    expect(() => verifyReconciledCandidate(segment, [revision('hide')], row, sha, true)).toThrow('not executed');
    expect(() => verifyReconciledCandidate(segment, [revision('hide')], row, sha, true)).toThrow(
      MissingAuditRestorationError,
    );
  });
  it('records independently proven changed audio without claiming a restoration', () => {
    expect(verifyReconciledCandidate(segment, [revision('hide')], row, sha, true, 'd'.repeat(64))).toMatchObject({
      disposition: 'protected',
      intended: 'restore',
      reason: 'audio_changed',
      status: 'HIDDEN',
      expected_audio_sha256: row.audio_sha256,
      current_audio_sha256: 'd'.repeat(64),
    });
  });
  it('still rejects missing restoration when audio matches, or the supplied hash is invalid', () => {
    expect(() => verifyReconciledCandidate(segment, [revision('hide')], row, sha, true, row.audio_sha256)).toThrow(
      MissingAuditRestorationError,
    );
    expect(() => verifyReconciledCandidate(segment, [revision('hide')], row, sha, true, 'unavailable')).toThrow(
      'Invalid live audio hash',
    );
  });
  it('cannot use changed audio to bypass revision ownership validation', () => {
    expect(() => verifyReconciledCandidate(segment, [], row, sha, true, 'd'.repeat(64))).toThrow('ownership');
  });
  it('protects changed source and later human edits rather than claiming restoration', () => {
    expect(
      verifyReconciledCandidate({ ...segment, contentJa: 'changed' } as Segment, [revision('hide')], row, sha, true),
    ).toMatchObject({ disposition: 'protected', reason: 'source_changed' });
    const human = { id: 3, segmentId: 1, revisionNumber: 3, actor: 'HUMAN', snapshot: {} } as SegmentRevision;
    expect(verifyReconciledCandidate(segment, [revision('hide'), human], row, sha, true)).toMatchObject({
      disposition: 'protected',
      reason: 'edited_after_audit',
    });
  });
  it('protects deleted rows and status changes without another audit write', () => {
    expect(verifyReconciledCandidate(null, [], row, sha, true).disposition).toBe('protected');
    expect(
      verifyReconciledCandidate({ ...segment, status: 'ACTIVE' } as Segment, [revision('hide')], row, sha, true),
    ).toMatchObject({ disposition: 'protected', reason: 'status_changed' });
  });
  it('rejects foreign, duplicate or altered ownership evidence', () => {
    expect(() => verifyReconciledCandidate(segment, [], row, sha, true)).toThrow('ownership');
    expect(() => verifyReconciledCandidate(segment, [revision('hide'), revision('hide')], row, sha, false)).toThrow(
      'ownership',
    );
    const changed = revision('hide');
    (changed.snapshot.corpusAudit as Record<string, unknown>).audioSha = 'changed';
    expect(() => verifyReconciledCandidate(segment, [changed], row, sha, false)).toThrow('evidence');
  });
  it('rejects a rollback of a retained flag, or a rollback across an intervening edit', () => {
    expect(() => verifyReconciledCandidate(segment, [revision('hide'), revision('rollback')], row, sha, false)).toThrow(
      'Unexpected rollback',
    );
    const undo = revision('rollback');
    undo.revisionNumber = 3;
    expect(() => verifyReconciledCandidate(segment, [revision('hide'), undo], row, sha, true)).toThrow(
      'Unexpected rollback',
    );
  });
});
