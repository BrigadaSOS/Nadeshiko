import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH_STATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.auth');

export function e2eAuthStatePath(workerIndex: number, projectName = 'default'): string {
  const safeProject = projectName.replace(/[^a-zA-Z0-9_-]/g, '-');
  return resolve(AUTH_STATE_DIR, `${safeProject}-e2e-user-${workerIndex}.json`);
}
