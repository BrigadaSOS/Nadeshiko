import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_AUTH_STATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '.auth/e2e-user.json');
