import type { EntityManager } from 'typeorm';
import { Segment, SegmentStatus } from '@app/models/Segment';
import { SegmentRevision, RevisionActor } from '@app/models/SegmentRevision';
import { toSegmentSnapshot } from '@app/controllers/mappers/segmentMapper';
import { createSegmentRevision } from '@app/controllers/segmentController';
import type { AuditCandidate } from './auditManifest';
import { isStrongPreventiveCandidate } from './auditManifest';

export interface AuditApplyOptions {
  manifestSha: string;
  write: boolean;
  rollback: boolean;
  userId: number;
  preventive?: boolean;
}

export function audioKey(segment: Segment): string {
  return `${segment.storageBasePath}/${segment.externalVideoId ?? segment.episode}/${segment.hashedId}.mp3`.replace(
    /^\/+/,
    '',
  );
}

export function matchesAuditSource(segment: Segment, row: AuditCandidate): boolean {
  return (
    segment.id === row.id &&
    segment.publicId === row.public_id &&
    segment.contentJa === row.original.ja &&
    segment.contentEn === row.original.en &&
    segment.contentEs === row.original.es &&
    segment.startTimeMs === row.original.start_ms &&
    segment.endTimeMs === row.original.end_ms &&
    segment.storage.toUpperCase() === 'R2' &&
    audioKey(segment) === row.audio_key
  );
}

type AuditMarker = {
  manifestSha: string;
  phase: 'hide' | 'rollback';
  audioSha: string;
  policy: string;
  runId: string;
  inventorySignature: string;
};

function marker(revision: SegmentRevision): AuditMarker | undefined {
  const value = revision.snapshot.corpusAudit as AuditMarker | undefined;
  return value && typeof value.manifestSha === 'string' && ['hide', 'rollback'].includes(value.phase)
    ? value
    : undefined;
}

/** Caller owns the transaction. Only status changes; the revision doubles as a durable resume record. */
export async function applyAuditCandidate(manager: EntityManager, row: AuditCandidate, options: AuditApplyOptions) {
  const query = manager.createQueryBuilder(Segment, 'segment').where('segment.id = :id', { id: row.id });
  if (options.write) query.setLock('pessimistic_write');
  const segment = await query.getOne();
  if (!segment) return { id: row.id, outcome: 'missing' as const };
  if (!matchesAuditSource(segment, row)) return { id: row.id, outcome: 'source_changed' as const };
  const revisions = await manager.find(SegmentRevision, {
    where: { segmentId: row.id },
    order: { revisionNumber: 'DESC' },
  });
  const owned = revisions.find((revision) => marker(revision)?.manifestSha === options.manifestSha);
  const ownedMarker = owned && marker(owned);
  const latest = revisions[0];
  if (owned && latest?.id !== owned.id) return { id: row.id, outcome: 'edited_after_audit' as const };

  if (options.rollback) {
    if (!owned) return { id: row.id, outcome: 'not_applied' as const };
    if (ownedMarker?.phase === 'rollback') return { id: row.id, outcome: 'already_rolled_back' as const, sync: true };
    if (segment.status !== SegmentStatus.HIDDEN) return { id: row.id, outcome: 'status_changed' as const };
  } else {
    if (ownedMarker?.phase === 'rollback') return { id: row.id, outcome: 'already_rolled_back' as const };
    if (ownedMarker?.phase === 'hide' && segment.status === SegmentStatus.HIDDEN)
      return { id: row.id, outcome: 'already_applied' as const, sync: true };
    if (segment.status !== SegmentStatus.ACTIVE) return { id: row.id, outcome: 'status_changed' as const };
    const updated = segment.updatedAt?.getTime() ?? null;
    if (updated !== (row.updated_at === null ? null : new Date(row.updated_at).getTime()))
      return { id: row.id, outcome: 'edited_since_scan' as const };
    if (options.write && options.preventive && !isStrongPreventiveCandidate(row))
      throw new Error('Preventive writes require a high-confidence core Hide candidate');
    if (options.write && !options.preventive && row.policy !== 'automatic-core-v3')
      throw new Error('Only final adjudicated candidates may be applied');
  }

  const outcome = options.rollback ? 'restored' : 'hidden';
  if (!options.write) return { id: row.id, outcome: `would_${outcome}` as const };
  const snapshot = toSegmentSnapshot(segment);
  snapshot.corpusAudit = {
    manifestSha: options.manifestSha,
    phase: options.rollback ? 'rollback' : 'hide',
    audioSha: row.audio_sha256,
    policy: row.policy,
    runId: row.run_id,
    inventorySignature: row.inventory_signature,
  } satisfies AuditMarker;
  segment.status = options.rollback ? SegmentStatus.ACTIVE : SegmentStatus.HIDDEN;
  await manager.save(segment);
  await createSegmentRevision(manager, row.id, snapshot, {
    userId: options.userId,
    actor: RevisionActor.AGENT,
    reportId: null,
  });
  return { id: row.id, outcome, sync: true };
}
