import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getE2EBaseUrl } from './env';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });

const BASE_URL = getE2EBaseUrl('http://localhost:3000');
const E2E_USER_EMAIL = 'e2e-user@nadeshiko.co';
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD || '';

/**
 * Cleans up resources created by E2E tests:
 * - Revokes all sessions except the current one, then signs out
 * - Deactivates all API keys
 * - Deletes all user-created collections (non-default ones)
 * - Clears activity history
 */
export default async function globalTeardown() {
  if (!E2E_USER_PASSWORD) return;

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const request = context.request;

  try {
    const loginRes = await request.post('/v1/auth/sign-in/email', {
      headers: { Origin: BASE_URL },
      data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
    });
    if (!loginRes.ok()) return;

    // Delete all API keys (handles possibly-truncated responses by looping)
    for (let round = 0; round < 20; round++) {
      const keysRes = await request.get('/v1/auth/api-key/list');
      if (!keysRes.ok()) break;

      const text = await keysRes.text();
      const ids = [...text.matchAll(/"id":"(\d+)"/g)].map(m => m[1]);
      if (ids.length === 0) break;

      for (const id of [...new Set(ids)]) {
        await request.post('/v1/auth/api-key/delete', {
          headers: { Origin: BASE_URL },
          data: { keyId: id },
        }).catch(() => {});
      }
    }

    // Clean up collections (delete non-default ones created by tests)
    const collectionsRes = await request.get('/v1/collections?take=100');
    if (collectionsRes.ok()) {
      const data = await collectionsRes.json() as { collections?: { publicId: string; name: string; type: string }[] };
      for (const col of data.collections ?? []) {
        if (col.name.startsWith('e2e-')) {
          await request.delete(`/v1/collections/${col.publicId}`).catch(() => {});
        }
      }
    }

    // Clear hidden media
    await request.put('/v1/user/preferences', {
      data: { hiddenMedia: [] },
    }).catch(() => {});

    // Clear activity history
    await request.delete('/v1/user/activity').catch(() => {});

    // Revoke other sessions and sign out
    await request.post('/v1/auth/revoke-other-sessions', {
      headers: { Origin: BASE_URL },
    }).catch(() => {});
    await request.post('/v1/auth/sign-out', {
      headers: { Origin: BASE_URL },
    }).catch(() => {});
  } finally {
    await context.close();
    await browser.close();
  }
}
