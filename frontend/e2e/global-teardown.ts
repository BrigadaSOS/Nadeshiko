import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { e2eBypassHeaders, getE2EBaseUrl } from './env';
import { e2eAccountForWorker } from './auth';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });

const BASE_URL = getE2EBaseUrl('http://localhost:3000');
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD || '';
const E2E_ACCOUNTS = process.env.E2E_SMOKE ? 1 : 9;

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
  try {
    await Promise.all(
      Array.from({ length: E2E_ACCOUNTS }, async (_, workerIndex) => {
        const context = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: e2eBypassHeaders() });
        const request = context.request;
        try {
          const loginRes = await request.post('/v1/auth/sign-in/email', {
            headers: { Origin: BASE_URL },
            data: { email: e2eAccountForWorker(workerIndex).email, password: E2E_USER_PASSWORD },
          });
          if (!loginRes.ok()) return;

          // Delete all API keys (handles possibly-truncated responses by looping).
          for (let round = 0; round < 20; round++) {
            const keysRes = await request.get('/v1/auth/api-key/list');
            if (!keysRes.ok()) break;

            const text = await keysRes.text();
            const ids = [...text.matchAll(/"id":"(\d+)"/g)].map((match) => match[1]);
            if (ids.length === 0) break;

            await Promise.all(
              [...new Set(ids)].map((id) =>
                request
                  .post('/v1/auth/api-key/delete', { headers: { Origin: BASE_URL }, data: { keyId: id } })
                  .catch(() => {}),
              ),
            );
          }

          const collectionsRes = await request.get('/v1/collections?take=100');
          if (collectionsRes.ok()) {
            const data = (await collectionsRes.json()) as {
              collections?: { publicId: string; name: string }[];
            };
            await Promise.all(
              (data.collections ?? [])
                .filter((collection) => collection.name.startsWith('e2e-'))
                .map((collection) => request.delete(`/v1/collections/${collection.publicId}`).catch(() => {})),
            );
          }

          await Promise.all([
            request.patch('/v1/user/preferences', {
              data: {
                ankiProfiles: [],
                defaultSearchCategory: 'ALL',
                familiarMedia: { enabled: true },
                hiddenCategories: [],
                hiddenMedia: [],
                mediaCardDefault: 'OPEN',
                searchHistory: { enabled: true },
              },
            }).catch(() => {}),
            request.delete('/v1/user/activity').catch(() => {}),
            request.delete('/v1/user/familiar-media').catch(() => {}),
          ]);

          await request
            .post('/v1/auth/revoke-other-sessions', { headers: { Origin: BASE_URL } })
            .catch(() => {});
          await request.post('/v1/auth/sign-out', { headers: { Origin: BASE_URL } }).catch(() => {});
        } finally {
          await context.close();
        }
      }),
    );
  } finally {
    await browser.close();
  }
}
