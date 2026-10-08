import { createHash } from 'node:crypto';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const candidate = z
  .object({
    id: z.number().int().positive(),
    public_id: z.string().regex(/^[A-Za-z0-9_-]{12}$/),
    action: z.enum(['HIDE', 'REVIEW']),
    desired_status: z.literal('HIDDEN'),
    previous_status: z.literal('ACTIVE'),
    updated_at: z.string().nullable(),
    audio_key: z.string().min(1),
    audio_sha256: hash,
    inventory_signature: hash,
    policy: z.string().min(1),
    run_id: z.string().min(1),
    reasons: z.array(z.string()),
    asr: z.object({ transcript: z.string() }).optional(),
    reviews: z
      .object({
        primary: z.object({
          model: z.string(),
          audio_ja: z.string(),
          en: z.string(),
          issues: z.array(
            z.object({
              check: z.string(),
              confidence: z.string(),
              ja_quote: z.string(),
              comparison_quote: z.string(),
            }),
          ),
        }),
      })
      .optional(),
    original: z.object({
      ja: z.string().min(1),
      en: z.string(),
      es: z.string(),
      start_ms: z.number().int().nonnegative(),
      end_ms: z.number().int().positive(),
    }),
    quality: z.object({
      core: z.object({
        decision: z.enum(['HIDE', 'REVIEW']),
        affects_visibility: z.literal(true),
        reasons: z.array(z.string()),
      }),
      spanish: z.object({ affects_visibility: z.literal(false) }),
    }),
  })
  .refine((row) => row.original.end_ms > row.original.start_ms, 'Invalid clip timing')
  .refine((row) => row.quality.core.decision === row.action, 'Core decision differs from action')
  .refine(
    (row) => row.reasons.some((reason) => !reason.startsWith('ES_')),
    'Spanish-only concerns cannot hide a segment',
  );

export type AuditCandidate = z.infer<typeof candidate>;

export function parseAuditManifest(text: string): AuditCandidate[] {
  const rows = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => candidate.parse(JSON.parse(line)));
  const ids = new Set<number>();
  const publicIds = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id) || publicIds.has(row.public_id)) throw new Error('Duplicate segment in audit manifest');
    ids.add(row.id);
    publicIds.add(row.public_id);
  }
  return rows.sort((a, b) => a.id - b.id);
}

export function manifestHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A write accepts only the exact manifest covered by full final verification. */
export function validateFinalVerification(value: unknown, sha: string): void {
  const verification = z
    .object({
      stage: z.literal('final'),
      complete: z.literal(true),
      verified_segments: z.number().int().positive(),
      catalog_total: z.number().int().positive(),
      production_changed: z.literal(false),
      manifest_sha256: z.object({ 'hide-core-candidates.jsonl': hash }),
    })
    .parse(value);
  if (
    verification.verified_segments !== verification.catalog_total ||
    verification.manifest_sha256['hide-core-candidates.jsonl'] !== sha
  ) {
    throw new Error('Manifest is not covered by full final verification');
  }
}

/** The explicitly authorized early rollout accepts only literal, high-confidence core evidence. */
export function isStrongPreventiveCandidate(row: AuditCandidate): boolean {
  const review = row.reviews?.primary;
  return (
    row.policy === 'first-pass-core-v3' &&
    row.action === 'HIDE' &&
    review?.model === 'gpt-6.1-sol' &&
    review.issues.some((issue) => {
      const check = issue.check;
      const reason = check === 'audio_ja' ? 'JA_AUDIO_MISMATCH' : 'EN_TRANSLATION_MISMATCH';
      const comparison = check === 'audio_ja' ? row.asr?.transcript : row.original.en;
      return (
        ['audio_ja', 'en'].includes(check) &&
        review[check as 'audio_ja' | 'en'] === 'mismatch' &&
        row.reasons.includes(reason) &&
        issue.confidence === 'high' &&
        issue.ja_quote.trim().length > 0 &&
        issue.comparison_quote.trim().length > 0 &&
        row.original.ja.includes(issue.ja_quote) &&
        comparison?.includes(issue.comparison_quote) === true
      );
    })
  );
}

/** Separate from full-corpus final verification; never admits Review or Spanish-only rows. */
export function validatePreventiveVerification(value: unknown, sha: string, rows: AuditCandidate[]): void {
  const verification = z
    .object({
      stage: z.literal('preventive-batch'),
      complete: z.literal(true),
      verified_candidates: z.number().int().min(1).max(1000),
      verified_ids: z.array(z.number().int().positive()),
      source_checkpoint: z.object({
        stage: z.literal('firstpass'),
        verified_segments: z.number().int().positive(),
        catalog_total: z.number().int().positive(),
        manifest_sha256: hash,
      }),
      checks: z.object({
        parent_manifest_matched: z.literal(true),
        source_inventory_bound: z.literal(true),
        primary_evidence_bound: z.literal(true),
        core_high_confidence: z.literal(true),
        spanish_separate: z.literal(true),
      }),
      manifest_sha256: z.object({ 'hide-core-candidates.jsonl': hash }),
    })
    .parse(value);
  if (
    verification.verified_candidates !== rows.length ||
    verification.manifest_sha256['hide-core-candidates.jsonl'] !== sha ||
    verification.source_checkpoint.verified_segments > verification.source_checkpoint.catalog_total ||
    JSON.stringify(verification.verified_ids) !== JSON.stringify(rows.map((row) => row.id)) ||
    rows.some((row) => !isStrongPreventiveCandidate(row))
  ) {
    throw new Error('Preventive manifest is not covered by bounded high-confidence verification');
  }
}
