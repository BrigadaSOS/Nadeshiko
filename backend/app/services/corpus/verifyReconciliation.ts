import type { Segment } from '@app/models/Segment';
import type { SegmentRevision } from '@app/models/SegmentRevision';
import type { AuditCandidate } from './auditManifest';
import { matchesAuditSource } from './applyAudit';

export class MissingAuditRestorationError extends Error {
  constructor(readonly segmentId: number) {
    super(`Required restoration not executed:${segmentId}`);
  }
}

/** Read-only proof of one previously published hide after final reconciliation. */
export function verifyReconciledCandidate(
  segment: Segment | null,
  revisions: SegmentRevision[],
  row: AuditCandidate,
  manifestSha: string,
  restore: boolean,
  currentAudioSha?: string,
) {
  const protectedResult = (reason: string) => ({
    id: row.id,
    disposition: 'protected' as const,
    intended: restore ? 'restore' : 'retain',
    reason,
    status: segment?.status ?? null,
  });
  if (!segment) return protectedResult('missing');
  const history = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  const owned = history.filter((r) => {
    const marker = r.snapshot.corpusAudit as Record<string, unknown> | undefined;
    return marker?.manifestSha === manifestSha;
  });
  for (const revision of owned) {
    const marker = revision.snapshot.corpusAudit as Record<string, unknown>;
    if (
      revision.segmentId !== row.id ||
      revision.actor !== 'AGENT' ||
      marker.audioSha !== row.audio_sha256 ||
      marker.inventorySignature !== row.inventory_signature ||
      marker.policy !== row.policy ||
      marker.runId !== row.run_id ||
      !['hide', 'rollback'].includes(String(marker.phase))
    )
      throw new Error(`Audit revision evidence mismatch:${row.id}`);
  }
  const hides = owned.filter((r) => (r.snapshot.corpusAudit as Record<string, unknown>).phase === 'hide');
  const rollbacks = owned.filter((r) => (r.snapshot.corpusAudit as Record<string, unknown>).phase === 'rollback');
  const hide = hides[0],
    rollback = rollbacks[0],
    latestOwned = owned[0];
  if (hides.length !== 1 || rollbacks.length > 1 || !hide || !latestOwned || hide.snapshot.status !== 'ACTIVE')
    throw new Error(`Published hide ownership mismatch:${row.id}`);
  if (
    rollback &&
    (!restore || rollback.snapshot.status !== 'HIDDEN' || rollback.revisionNumber !== hide.revisionNumber + 1)
  )
    throw new Error(`Unexpected rollback revision:${row.id}`);
  if (!matchesAuditSource(segment, row)) return protectedResult('source_changed');
  if (history[0]?.id !== owned[0]?.id) return protectedResult('edited_after_audit');
  if (restore && !rollbacks.length) {
    if (segment.status !== 'HIDDEN') return protectedResult('status_changed');
    if (currentAudioSha !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(currentAudioSha)) throw new Error(`Invalid live audio hash:${row.id}`);
      if (currentAudioSha !== row.audio_sha256)
        return {
          ...protectedResult('audio_changed'),
          expected_audio_sha256: row.audio_sha256,
          current_audio_sha256: currentAudioSha,
        };
    }
    throw new MissingAuditRestorationError(row.id);
  }
  const expectedStatus = restore ? 'ACTIVE' : 'HIDDEN';
  if (segment.status !== expectedStatus) return protectedResult('status_changed');
  return {
    id: row.id,
    disposition: restore ? ('restored' as const) : ('retained' as const),
    status: segment.status,
    source_unchanged: true,
    latest_owned_revision_id: latestOwned.id,
  };
}
