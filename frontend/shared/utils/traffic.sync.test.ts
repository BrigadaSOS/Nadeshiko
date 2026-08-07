import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The bot list is duplicated: once here, once in backend/lib/traffic.ts.
 *
 * That is a deliberate choice (two separate builds, no shared package), and
 * this test is what makes it survivable. Both files carry the same block
 * between MIRRORED markers, and drift between them is not a cosmetic problem:
 * the frontend labels a visitor `bot` and propagates it, the backend labels the
 * same visitor `reader` from a User-Agent it classifies differently, and the
 * two services then disagree about how much of the traffic is crawlers — with
 * nothing anywhere saying so.
 *
 * When this fails: copy the mirrored block from whichever file you edited into
 * the other, verbatim. Nothing else is expected to match — the helpers outside
 * the markers are per-runtime.
 */

const MIRRORED = /\/\/ --- BEGIN MIRRORED BLOCK[^\n]*\n([\s\S]*?)\/\/ --- END MIRRORED BLOCK ---/;

const FRONTEND = fileURLToPath(new URL('./traffic.ts', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../../backend/lib/traffic.ts', import.meta.url));

function mirroredBlock(path: string): string {
  const match = MIRRORED.exec(readFileSync(path, 'utf8'));
  if (!match?.[1]) throw new Error(`No MIRRORED block found in ${path}`);
  return match[1].trim();
}

describe('traffic classifier copies', () => {
  // Skipped rather than failed where the backend is not on disk: the frontend
  // suite also runs inside an image built from frontend/ alone.
  it.skipIf(!existsSync(BACKEND))('are identical between the frontend and the backend', () => {
    expect(mirroredBlock(FRONTEND)).toBe(mirroredBlock(BACKEND));
  });
});
