/**
 * The live `generated/` tree is imported as the `generated/*` path alias.
 * `generate:api` used to `rm -rf` it first, which is the thing that takes a
 * running `--watch` server down: Node sees the imports vanish, restarts,
 * fails with ERR_MODULE_NOT_FOUND, and then sits on "Waiting for file
 * changes" because the files that will come back were never in the watch set
 * of the failed process.
 *
 * Codegen now writes into a staging directory and publishes over the live
 * tree without deleting it. This module is the other half: the dev entry
 * waits for a marker written last, so even a missing tree is a pause rather
 * than a crash.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const GENERATED_READY_MARKER = '.ready';

/**
 * The files `generate:api` always writes. A committed tree has these and no
 * marker (the marker is gitignored), so a checkout must still count as ready.
 */
export const REQUIRED_GENERATED_FILES = [
  'errorProfiles.ts',
  'index.ts',
  'models.ts',
  'outputTypes.ts',
  'publicApiRoutes.ts',
  'routeAuth.ts',
  'schemas.ts',
] as const;

export function defaultGeneratedDir(): string {
  return resolve(import.meta.dirname, '../../generated');
}

export function resolveGeneratedDir(): string {
  return process.env.GENERATED_DIR ?? process.env.OUTPUT_TYPES_GENERATED_DIR ?? defaultGeneratedDir();
}

export function generatedReadyPath(dir: string): string {
  return join(dir, GENERATED_READY_MARKER);
}

export function isGeneratedReady(dir: string): boolean {
  if (existsSync(generatedReadyPath(dir))) return true;
  return REQUIRED_GENERATED_FILES.every((file) => existsSync(join(dir, file)));
}

export function clearGeneratedReady(dir: string): void {
  rmSync(generatedReadyPath(dir), { force: true });
}

export function markGeneratedReady(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(generatedReadyPath(dir), '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new Error('Aborted while waiting for generated/', { cause: signal.reason });
}

export async function waitForGenerated(
  dir: string,
  options: { intervalMs?: number; signal?: AbortSignal; onWaiting?: () => void } = {},
): Promise<void> {
  throwIfAborted(options.signal);
  if (isGeneratedReady(dir)) return;

  options.onWaiting?.();
  const intervalMs = options.intervalMs ?? 250;

  while (!isGeneratedReady(dir)) {
    throwIfAborted(options.signal);
    await sleep(intervalMs);
  }
}
