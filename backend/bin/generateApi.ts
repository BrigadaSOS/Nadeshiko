/** Regenerates `generated/` through staging rather than deleting the live tree: directory watchers remain attached,
 * removed outputs are pruned, and `.ready` is written last so `bin/dev.ts` can wait. */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clearGeneratedReady, defaultGeneratedDir, markGeneratedReady } from './lib/generatedReady';

export const STAGING_DIR_NAME = 'generated.next';

const BACKEND_ROOT = resolve(import.meta.dirname, '..');
const LIVE_DIR = defaultGeneratedDir();
const STAGING_DIR = resolve(BACKEND_ROOT, STAGING_DIR_NAME);

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: BACKEND_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

function listFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile()) acc.push(fullPath);
  }

  return acc;
}

function pruneEmptyDirs(dir: string, keepRoot: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      pruneEmptyDirs(join(dir, entry.name), keepRoot);
    }
  }

  if (dir !== keepRoot && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true });
  }
}

/** Replace contents without deleting the watched directory. */
export function publishGenerated(staging: string, live: string): void {
  if (!existsSync(staging)) {
    throw new Error(`Staging directory does not exist: ${staging}`);
  }

  mkdirSync(live, { recursive: true });
  cpSync(staging, live, { recursive: true });

  const stagingFiles = new Set(listFiles(staging).map((filePath) => relative(staging, filePath)));
  for (const liveFile of listFiles(live)) {
    if (!stagingFiles.has(relative(live, liveFile))) {
      rmSync(liveFile);
    }
  }

  pruneEmptyDirs(live, live);
}

async function generateApi(): Promise<void> {
  rmSync(STAGING_DIR, { recursive: true, force: true });
  clearGeneratedReady(LIVE_DIR);

  await run('npm', ['run', 'docs:bundle']);

  await run('openapi-code-generator', [
    '--input',
    './docs/generated/openapi.yaml',
    '--input-type',
    'openapi3',
    '--output',
    STAGING_DIR,
    '--template',
    'typescript-express',
    '--schema-builder',
    'zod-v4',
    '--grouping-strategy',
    'first-tag',
  ]);

  const stagingEnv = { GENERATED_DIR: STAGING_DIR };

  await run('node', ['--import', 'tsx', 'bin/generateOutputTypes.ts'], stagingEnv);
  await run('node', ['--import', 'tsx', 'bin/generateRouteAuth.ts'], stagingEnv);
  await run('node', ['--import', 'tsx', 'bin/generateErrorProfiles.ts'], stagingEnv);
  await run('node', ['--import', 'tsx', 'bin/generatePublicRoutes.ts'], stagingEnv);
  await run('node', ['--import', 'tsx', 'bin/generateServerOnlyRoutes.ts'], stagingEnv);

  publishGenerated(STAGING_DIR, LIVE_DIR);
  markGeneratedReady(LIVE_DIR);
  rmSync(STAGING_DIR, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateApi().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
