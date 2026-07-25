import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loginAsE2EUser } from '../auth';
import { E2E_AUTH_STATE_PATH } from '../auth-state';
import { test as setup } from '../fixtures';

setup('authenticate E2E user', async ({ page }) => {
  await loginAsE2EUser(page);
  await mkdir(dirname(E2E_AUTH_STATE_PATH), { recursive: true });
  await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
});