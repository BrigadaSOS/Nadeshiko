import { describe, expect, it } from 'vitest';
import {
  manifestHash,
  parseAuditManifest,
  validateFinalVerification,
  validatePreventiveVerification,
  isStrongPreventiveCandidate,
} from '@app/services/corpus/auditManifest';

const row = {
  id: 1,
  public_id: 'audit0000001',
  action: 'REVIEW',
  desired_status: 'HIDDEN',
  previous_status: 'ACTIVE',
  updated_at: null,
  audio_key: 'media/1/1/a.mp3',
  audio_sha256: 'a'.repeat(64),
  inventory_signature: 'b'.repeat(64),
  policy: 'automatic-core-v3',
  run_id: 'test-final',
  reasons: ['JA_AUDIO_MISMATCH_UNVERIFIED'],
  original: { ja: '日本語', en: 'Japanese', es: 'Japonés', start_ms: 100, end_ms: 1000 },
  quality: {
    core: { decision: 'REVIEW', affects_visibility: true, reasons: ['JA_AUDIO_MISMATCH_UNVERIFIED'] },
    spanish: { affects_visibility: false },
  },
};

describe('audit apply manifests', () => {
  it('rejects duplicates and Spanish-only hiding proposals', () => {
    expect(() => parseAuditManifest(`${JSON.stringify(row)}\n${JSON.stringify(row)}\n`)).toThrow('Duplicate');
    expect(() => parseAuditManifest(JSON.stringify({ ...row, reasons: ['ES_TRANSLATION_MISMATCH'] }))).toThrow();
  });

  it('rejects passing rows and contradictory core verdicts', () => {
    expect(() => parseAuditManifest(JSON.stringify({ ...row, action: 'NO_PROBLEM' }))).toThrow();
    expect(() => parseAuditManifest(JSON.stringify({ ...row, action: 'HIDE' }))).toThrow();
  });

  it('binds full final verification to the exact file bytes', () => {
    const text = `${JSON.stringify(row)}\n`;
    const sha = manifestHash(Buffer.from(text));
    const verification = {
      stage: 'final',
      complete: true,
      verified_segments: 10,
      catalog_total: 10,
      production_changed: false,
      manifest_sha256: { 'hide-core-candidates.jsonl': sha },
    };
    expect(() => validateFinalVerification(verification, sha)).not.toThrow();
    expect(() => validateFinalVerification(verification, manifestHash(Buffer.from(text.trim())))).toThrow();
    expect(() => validateFinalVerification({ ...verification, verified_segments: 9 }, sha)).toThrow();
    expect(() => validateFinalVerification({ ...verification, stage: 'firstpass' }, sha)).toThrow();
  });

  it('binds an explicitly bounded preventive batch to high-confidence core evidence', () => {
    const early = {
      ...row,
      action: 'HIDE',
      policy: 'first-pass-core-v3',
      reasons: ['EN_TRANSLATION_MISMATCH'],
      quality: { ...row.quality, core: { ...row.quality.core, decision: 'HIDE' } },
      asr: { transcript: '日本語' },
      reviews: {
        primary: {
          model: 'gpt-6.1-sol',
          audio_ja: 'compatible',
          en: 'mismatch',
          issues: [{ check: 'en', confidence: 'high', ja_quote: '日本語', comparison_quote: 'Japanese' }],
        },
      },
    };
    const text = `${JSON.stringify(early)}\n`;
    const rows = parseAuditManifest(text);
    const sha = manifestHash(Buffer.from(text));
    const verification = {
      stage: 'preventive-batch',
      complete: true,
      verified_candidates: 1,
      verified_ids: [1],
      source_checkpoint: {
        stage: 'firstpass',
        verified_segments: 800000,
        catalog_total: 1427273,
        manifest_sha256: 'd'.repeat(64),
      },
      checks: {
        parent_manifest_matched: true,
        source_inventory_bound: true,
        primary_evidence_bound: true,
        core_high_confidence: true,
        spanish_separate: true,
      },
      manifest_sha256: { 'hide-core-candidates.jsonl': sha },
    };
    expect(isStrongPreventiveCandidate(rows[0]!)).toBe(true);
    expect(() => validatePreventiveVerification(verification, sha, rows)).not.toThrow();
    expect(() => validateFinalVerification(verification, sha)).toThrow();
    expect(() => validatePreventiveVerification({ ...verification, verified_ids: [2] }, sha, rows)).toThrow();
    expect(() => validatePreventiveVerification(verification, 'e'.repeat(64), rows)).toThrow();
    expect(() => validatePreventiveVerification({ ...verification, verified_candidates: 1001 }, sha, rows)).toThrow();
    const weak = structuredClone(rows[0]!);
    weak.reviews!.primary.issues[0]!.confidence = 'medium';
    expect(isStrongPreventiveCandidate(weak)).toBe(false);
    expect(() => validatePreventiveVerification(verification, sha, [weak])).toThrow();
    weak.reviews!.primary.issues[0]!.confidence = 'high';
    weak.reviews!.primary.issues[0]!.comparison_quote = 'invented';
    expect(isStrongPreventiveCandidate(weak)).toBe(false);
    const review = { ...rows[0]!, action: 'REVIEW' as const };
    expect(isStrongPreventiveCandidate(review)).toBe(false);
    const spanish = structuredClone(rows[0]!);
    spanish.reviews!.primary.issues[0]!.check = 'es';
    expect(isStrongPreventiveCandidate(spanish)).toBe(false);
  });
});
