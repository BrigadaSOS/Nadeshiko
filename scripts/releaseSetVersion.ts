/**
 * `npm run release:set-version <X.Y.Z>`: set the version everywhere, regenerate the specs, the SDK and the docs,
 * then check every version string agrees.
 *
 * This used to be a `bash -c '... "$1"' --` one-liner in package.json. npm runs scripts through cmd.exe on Windows,
 * where that form never received the version ("Missing version"), so the steps live here and run the same way on
 * every platform.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command: string, args: string[]): void {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  // `shell` so `npm` resolves to npm.cmd on Windows; arguments are fixed strings plus a validated version.
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`release:set-version: "${[command, ...args].join(' ')}" failed`);
    process.exit(result.status ?? 1);
  }
}

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run release:set-version -- <X.Y.Z>');
  process.exit(1);
}

run('node', ['--import', 'tsx', 'scripts/releaseVersion.ts', 'set', version]);
run('npm', ['run', 'generate:all', '--workspace', 'backend']);
run('npm', ['run', 'sdk:codegen']);
run('node', ['--import', 'tsx', 'scripts/releaseVersion.ts', 'check', version]);
