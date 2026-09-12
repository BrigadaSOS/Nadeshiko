import { chromium, type APIResponse } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { e2eBypassHeaders, getE2EBaseUrl } from './env';
import { e2eAccountForWorker } from './auth';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/.env') });

const BASE_URL = getE2EBaseUrl('http://localhost:3000');
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD || '';
const E2E_ACCOUNTS = process.env.E2E_SMOKE ? 1 : 10;

/**
 * Cleans up resources created by E2E tests:
 * - Revokes all sessions except the current one, then signs out
 * - Deactivates all API keys
 * - Deletes all user-created collections (non-default ones)
 * - Clears activity history
 */
export default async function globalTeardown() {
  if (!E2E_USER_PASSWORD) return;

  const failures: string[] = [];
  const requireOk = async (label: string, operation: Promise<APIResponse>): Promise<APIResponse | null> => {
    try {
      const response = await operation;
      if (!response.ok()) failures.push(`${label}: HTTP ${response.status()} ${await response.text()}`);
      return response.ok() ? response : null;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const browser = await chromium.launch();
  try {
    await Promise.all(
      Array.from({ length: E2E_ACCOUNTS }, async (_, workerIndex) => {
        const context = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: e2eBypassHeaders() });
        const request = context.request;
        try {
          const loginRes = await requireOk(
            `worker ${workerIndex} login`,
            request.post('/v1/auth/sign-in/email', {
              headers: { Origin: BASE_URL },
              data: { email: e2eAccountForWorker(workerIndex).email, password: E2E_USER_PASSWORD },
            }),
          );
          if (!loginRes) return;

          // Delete all API keys (handles possibly-truncated responses by looping).
          for (let round = 0; round < 20; round++) {
            const keysRes = await requireOk(`worker ${workerIndex} list API keys`, request.get('/v1/auth/api-key/list'));
            if (!keysRes) break;

            const text = await keysRes.text();
            const ids = [...text.matchAll(/"id":"(\d+)"/g)].map((match) => match[1]);
            if (ids.length === 0) break;

            await Promise.all(
              [...new Set(ids)].map((id) =>
                requireOk(
                  `worker ${workerIndex} delete API key ${id}`,
                  request.post('/v1/auth/api-key/delete', { headers: { Origin: BASE_URL }, data: { keyId: id } }),
                ),
              ),
            );
          }

          const collectionsRes = await requireOk(
            `worker ${workerIndex} list collections`,
            request.get('/v1/collections?take=100'),
          );
          if (collectionsRes) {
            const data = (await collectionsRes.json()) as {
              collections?: { publicId: string; name: string }[];
            };
            await Promise.all(
              (data.collections ?? [])
                .filter((collection) => collection.name.startsWith('e2e-'))
                .map((collection) =>
                  requireOk(
                    `worker ${workerIndex} delete collection ${collection.publicId}`,
                    request.delete(`/v1/collections/${collection.publicId}`),
                  ),
                ),
            );
          }

          await Promise.all([
            requireOk(
              `worker ${workerIndex} reset preferences`,
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
              }),
            ),
            requireOk(`worker ${workerIndex} clear activity`, request.delete('/v1/user/activity')),
            requireOk(`worker ${workerIndex} clear familiar media`, request.delete('/v1/user/familiar-media')),
          ]);

          await requireOk(
            `worker ${workerIndex} revoke other sessions`,
            request.post('/v1/auth/revoke-other-sessions', { headers: { Origin: BASE_URL } }),
          );
          await requireOk(
            `worker ${workerIndex} sign out`,
            request.post('/v1/auth/sign-out', { headers: { Origin: BASE_URL } }),
          );
        } finally {
          await context.close();
        }
      }),
    );
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    throw new AggregateError(failures.map((message) => new Error(message)), 'E2E cleanup failed');
  }
}
