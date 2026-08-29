import { describe, test, expect, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

import { startHealthServer } from '../../health';

/**
 * Kamal polls this endpoint to decide whether a deploy succeeded and whether a
 * running container is still alive. Both answers are load-bearing: a server
 * that 404s `/up` fails every deploy, and one that answers 200 on every path
 * would report healthy from a process that is past reasoning about anything.
 *
 * Driven over a real socket rather than by calling the handler, because the
 * listen call and the JSON content type are part of what Kamal checks.
 */
let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** Starts the server on an ephemeral port and returns its base URL. */
async function start(): Promise<string> {
  server = startHealthServer(0);
  await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('expected a TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('health server', () => {
  test('answers /up with an ok status', async () => {
    const base = await start();

    const response = await fetch(`${base}/up`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('declares JSON, because the body is JSON', async () => {
    const base = await start();

    const response = await fetch(`${base}/up`);

    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('404s any other path rather than reporting healthy for everything', async () => {
    const base = await start();

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
  });

  test('closing it releases the port, so a restart is not blocked by the old process', async () => {
    const base = await start();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;

    await expect(fetch(`${base}/up`)).rejects.toThrow();
  });
});
