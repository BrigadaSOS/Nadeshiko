#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Command = 'breaking' | 'changelog' | 'diff';

const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(BACKEND_DIR, '..');
const REDOCLY_BIN = join(BACKEND_DIR, 'node_modules', '.bin', 'redocly');
const OASDIFF_BIN = process.env.OASDIFF_BIN ?? 'oasdiff';

function fail(message: string): never {
  console.error(`openapiDiff failed: ${message}`);
  process.exit(1);
}

function run(
  cmd: [string, ...string[]],
  options: { cwd?: string; allowFailure?: boolean } = {},
): { exitCode: number; stdout: string; stderr: string } {
  const [executable, ...args] = cmd;
  const proc = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    // A wide `changelog` renders megabytes of markdown to stdout, which the
    // 1 MB default would truncate into an ENOBUFS failure.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error) {
    if ((proc.error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(
        `${executable} is not installed or not on PATH. Install it (oasdiff: https://github.com/oasdiff/oasdiff) and retry.`,
      );
    }
    throw proc.error;
  }

  const stdout = proc.stdout ?? '';
  const stderr = proc.stderr ?? '';
  const exitCode = proc.status ?? 1;
  if (exitCode !== 0 && !options.allowFailure) {
    const rendered = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    fail(`Command failed (${cmd.join(' ')}).\n${rendered}`);
  }
  return { exitCode, stdout, stderr };
}

const [commandArg, ...rest] = process.argv.slice(2);
if (!commandArg || !['breaking', 'changelog', 'diff'].includes(commandArg)) {
  fail('Usage: npm run openapi:<breaking|changelog|diff> -- [--from <git-ref>]');
}
const command = commandArg as Command;

let from = 'origin/main';
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--from') {
    from = rest[++i] ?? fail('Missing value for --from');
    continue;
  }
  fail(`Unknown option: ${rest[i]}`);
}

const tempRoot = await mkdtemp(join(tmpdir(), 'nadeshiko-oasdiff-'));

try {
  const pathsResult = run(
    // redocly.yaml loads plugins by relative path, so they have to come along or
    // bundling the base ref fails before oasdiff ever runs.
    [
      'git',
      'ls-tree',
      '-r',
      '--name-only',
      from,
      '--',
      'backend/docs/openapi',
      'backend/docs/plugins',
      'backend/redocly.yaml',
    ],
    { cwd: REPO_ROOT },
  );
  const paths = pathsResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (paths.length === 0) fail(`Git ref ${from} does not contain backend OpenAPI files.`);

  for (const repoRelativePath of paths) {
    const fileResult = run(['git', 'show', `${from}:${repoRelativePath}`], { cwd: REPO_ROOT });
    const destination = join(tempRoot, repoRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, fileResult.stdout);
  }

  const baseBundlePath = join(tempRoot, 'base-openapi.yaml');
  const revisionBundlePath = join(tempRoot, 'revision-openapi.yaml');
  const bundleArgs = ['bundle', 'public', '--remove-unused-components', '-o'];

  run([REDOCLY_BIN, ...bundleArgs, baseBundlePath], { cwd: join(tempRoot, 'backend') });
  run([REDOCLY_BIN, ...bundleArgs, revisionBundlePath], { cwd: BACKEND_DIR });

  const commandArgs: [string, ...string[]] = [OASDIFF_BIN, command, baseBundlePath, revisionBundlePath];
  if (command === 'changelog') commandArgs.push('--format', 'markdown');

  const result = run(commandArgs, { cwd: BACKEND_DIR, allowFailure: command === 'breaking' });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exit(result.exitCode);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
