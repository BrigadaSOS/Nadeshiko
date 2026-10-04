import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('./install-linux-native-bindings.mjs', import.meta.url));
let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nadeshiko-native-bindings-'));
  writeFileSync(join(directory, 'npm'), '#!/bin/sh\necho unexpected-registry-access >&2\nexit 1\n', { mode: 0o700 });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function writePackage(relativePath, manifest) {
  const path = join(directory, relativePath, 'package.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest));
}

function runInstaller() {
  return spawnSync(process.execPath, [installer], {
    cwd: directory,
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function expectNothingMissing(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Native bindings: nothing missing\./);
  assert.equal(result.stderr, '');
}

test('exits successfully when there are no native dependencies', () => {
  expectNothingMissing(runInstaller());
});

for (const nested of [false, true]) {
  test(`resolves an installed platform binding (${nested ? 'nested' : 'root'}) without downloading`, () => {
    const name = `fixture-native-${process.platform}-${process.arch}-gnu`;
    writePackage('node_modules/consumer', { name: 'consumer', optionalDependencies: { [name]: '1.0.0' } });
    writePackage(join(nested ? 'node_modules/consumer/node_modules' : 'node_modules', name), {
      name,
      version: '1.0.0',
    });

    expectNothingMissing(runInstaller());
  });
}
