import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishGenerated } from '../../bin/generateApi';
import { GENERATED_READY_MARKER } from '../../bin/lib/generatedReady';

let staging: string;
let live: string;

beforeEach(() => {
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-staging-'));
  live = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-live-'));
});

afterEach(() => {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(live, { recursive: true, force: true });
});

function write(root: string, relativePath: string, contents: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

describe('publishGenerated', () => {
  it('overwrites live files without deleting the live directory', () => {
    write(live, 'models.ts', 'old\n');
    write(staging, 'models.ts', 'new\n');
    write(staging, 'routes/user.ts', 'export {}\n');

    const liveInode = fs.statSync(live).ino;
    publishGenerated(staging, live);

    expect(fs.statSync(live).ino).toBe(liveInode);
    expect(fs.readFileSync(path.join(live, 'models.ts'), 'utf-8')).toBe('new\n');
    expect(fs.readFileSync(path.join(live, 'routes/user.ts'), 'utf-8')).toBe('export {}\n');
  });

  it('prunes live files and empty dirs that are not in staging', () => {
    write(live, 'models.ts', 'keep-me-overwritten\n');
    write(live, 'routes/legacy.ts', 'stale\n');
    write(staging, 'models.ts', 'fresh\n');

    publishGenerated(staging, live);

    expect(fs.existsSync(path.join(live, 'models.ts'))).toBe(true);
    expect(fs.existsSync(path.join(live, 'routes/legacy.ts'))).toBe(false);
    expect(fs.existsSync(path.join(live, 'routes'))).toBe(false);
  });

  it('does not copy a leftover ready marker from live into the published tree', () => {
    write(live, GENERATED_READY_MARKER, '');
    write(live, 'stale.ts', 'gone\n');
    write(staging, 'models.ts', 'ok\n');

    publishGenerated(staging, live);

    expect(fs.existsSync(path.join(live, GENERATED_READY_MARKER))).toBe(false);
    expect(fs.existsSync(path.join(live, 'stale.ts'))).toBe(false);
    expect(fs.existsSync(path.join(live, 'models.ts'))).toBe(true);
  });

  it('throws when staging is missing so a failed codegen cannot wipe live', () => {
    fs.rmSync(staging, { recursive: true, force: true });
    write(live, 'models.ts', 'still here\n');

    expect(() => publishGenerated(staging, live)).toThrow(/Staging directory does not exist/);
    expect(fs.readFileSync(path.join(live, 'models.ts'), 'utf-8')).toBe('still here\n');
  });
});
