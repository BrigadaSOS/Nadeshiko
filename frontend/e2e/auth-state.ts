import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH_STATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.auth');

export function e2eAuthStatePath(workerIndex: number): string {
  return resolve(AUTH_STATE_DIR, `e2e-user-${workerIndex}.json`);
}
