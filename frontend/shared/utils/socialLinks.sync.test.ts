import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISCORD_GUILD_ID, DISCORD_INVITE_CODE } from './socialLinks';

// Check literal invite copies in content, docs and the separately built bot. Live validity belongs to Gatus,
// not this repository test.

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'playwright-report', 'test-results']);

// Skip tooling snapshots containing historical invites; .github is authored source and remains scanned.
const isScratchDir = (name: string) => name.startsWith('.') && name !== '.github';

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.vue', '.md', '.mdc', '.html', '.json', '.yml', '.yaml'];

// Test fixtures intentionally invent invite codes to exercise link parsing.
const isFixture = (path: string) => path.endsWith('.test.ts');

const INVITE = /discord\.gg\/([A-Za-z0-9-]+)/g;

type Occurrence = { where: string; code: string };

function scan(dir: string, found: Occurrence[] = []): Occurrence[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !isScratchDir(entry.name)) scan(path, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (isFixture(path)) continue;

    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const match of line.matchAll(INVITE)) {
          found.push({ where: `${relative(REPO_ROOT, path)}:${index + 1}`, code: match[1] as string });
        }
      });
  }
  return found;
}

describe('Discord invite copies', () => {
  const occurrences = scan(REPO_ROOT);

  // A wrong repository root must not produce a vacuous pass.
  it('finds the invite where it is written out', () => {
    expect(occurrences.length).toBeGreaterThan(10);
  });

  it('all agree with DISCORD_INVITE_CODE', () => {
    const wrong = occurrences.filter((o) => o.code !== DISCORD_INVITE_CODE);
    expect(wrong.map((o) => `${o.where} -> ${o.code}`)).toEqual([]);
  });
});

// The sibling infra checkout carries the live Gatus check. Skip when absent because CI clones only this repo.
const GATUS_CONFIG = fileURLToPath(
  new URL('../../../../brigadasos-infra/machines/monitoring/gatus/config/config.yaml', import.meta.url),
);

describe.skipIf(!existsSync(GATUS_CONFIG))('Gatus invite check', () => {
  const config = () => readFileSync(GATUS_CONFIG, 'utf8');

  it('watches the current invite code', () => {
    expect(config()).toContain(`https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}`);
  });

  it('asserts the invite resolves to our guild', () => {
    expect(config()).toContain(DISCORD_GUILD_ID);
  });
});
