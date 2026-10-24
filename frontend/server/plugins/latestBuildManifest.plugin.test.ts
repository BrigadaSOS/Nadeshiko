import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Answering every build's `latest.json` with the running build's.
 *
 * Nuxt's outdated-build check polls `builds/latest.json` under `buildAssetsDir`,
 * and ours is per build, so a tab only ever asks its own build's URL: it reports
 * its own id until the deploy and 404s after it, and the check never fires. The
 * plugin is only worth anything if an OLD build's URL returns the NEW id -- that
 * is the case below that would have caught the original gap.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('~~/server/utils/logger', () => ({ logger }));

let runtimeConfig: { app: { buildId: string } };

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn);
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);
vi.stubGlobal('setResponseHeader', (event: FakeEvent, name: string, value: unknown) => {
  event.headers[name] = value;
});

type FakeEvent = { method: string; path: string; headers: Record<string, unknown> };

function makeEvent(path: string, method = 'GET'): FakeEvent {
  return { method, path, headers: {} };
}

function fakeNitroApp() {
  const stack: unknown[] = [{ route: '/', handler: 'nitro-static' }];
  return {
    h3App: {
      stack,
      use: (handler: unknown) => stack.push({ route: '/', handler }),
    },
  };
}

function installedHandler(app: ReturnType<typeof fakeNitroApp>) {
  const first = app.h3App.stack[0] as { handler?: unknown };
  return typeof first?.handler === 'function' ? (first.handler as (event: FakeEvent) => unknown) : undefined;
}

const LIVE_BUILD = '11111111-1111-4111-8111-111111111111';
const OLD_BUILD = '22222222-2222-4222-8222-222222222222';
const LIVE_MANIFEST = JSON.stringify({ id: LIVE_BUILD, timestamp: 1790934432267 });

let workDir: string;
let originalCwd: string;

function writeManifest(buildId: string, body: string) {
  const dir = join(workDir, '.output/public/_nuxt', buildId, 'builds');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'latest.json'), body);
}

async function boot(app: unknown = fakeNitroApp()) {
  vi.resetModules();
  const plugin = (await import('./03-latest-build-manifest')).default as (a: unknown) => Promise<void>;
  await plugin(app);
  return app as ReturnType<typeof fakeNitroApp>;
}

beforeEach(() => {
  vi.clearAllMocks();
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), 'nd-latest-manifest-'));
  process.chdir(workDir);
  runtimeConfig = { app: { buildId: LIVE_BUILD } };
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

describe('staying off', () => {
  test('stays off when there is no built manifest to read', async () => {
    const app = await boot();

    expect(installedHandler(app)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('staying off'));
  });

  test('stays off when the manifest names a different build', async () => {
    // Answering every tab with an id that is not the running build would send them all reloading for nothing.
    writeManifest(LIVE_BUILD, JSON.stringify({ id: OLD_BUILD, timestamp: 1 }));

    const app = await boot();

    expect(installedHandler(app)).toBeUndefined();
  });

  test('stays off when the request stack cannot be reached', async () => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);

    await boot({ h3App: undefined });

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cannot reach the request stack'));
  });
});

describe('serving', () => {
  test('installs ahead of Nitro’s static handler', async () => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);

    const app = await boot();

    expect(installedHandler(app)).toBeInstanceOf(Function);
    expect((app.h3App.stack.at(-1) as { handler: unknown }).handler).toBe('nitro-static');
  });

  test('answers a SUPERSEDED build’s URL with the running build’s id', async () => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);
    const handler = installedHandler(await boot())!;

    // Nuxt appends a timestamp query to bust caches.
    const event = makeEvent(`/_nuxt/${OLD_BUILD}/builds/latest.json?1790934500000`);
    const body = handler(event);

    expect(JSON.parse(body as string).id).toBe(LIVE_BUILD);
    expect(event.headers['Cache-Control']).toBe('no-cache');
    expect(event.headers['Content-Type']).toBe('application/json; charset=utf-8');
  });

  test('answers the running build’s own URL the same way', async () => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);
    const handler = installedHandler(await boot())!;

    expect(handler(makeEvent(`/_nuxt/${LIVE_BUILD}/builds/latest.json`))).toBe(LIVE_MANIFEST);
  });

  test('sends headers but no body for HEAD', async () => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);
    const handler = installedHandler(await boot())!;

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/builds/latest.json`, 'HEAD');

    expect(handler(event)).toBe('');
    expect(event.headers['Cache-Control']).toBe('no-cache');
  });

  test.each([
    ['a chunk', `/_nuxt/${OLD_BUILD}/entry.abc123.js`],
    ['build-addressed meta', `/_nuxt/${OLD_BUILD}/builds/meta/${OLD_BUILD}.json`],
    ['a page', '/en/search'],
  ])('falls through for %s', async (_label, path) => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);
    const handler = installedHandler(await boot())!;

    const event = makeEvent(path);

    expect(handler(event)).toBeUndefined();
    expect(event.headers).toEqual({});
  });

  test('falls through for writes', async () => {
    writeManifest(LIVE_BUILD, LIVE_MANIFEST);
    const handler = installedHandler(await boot())!;

    expect(handler(makeEvent(`/_nuxt/${OLD_BUILD}/builds/latest.json`, 'POST'))).toBeUndefined();
  });
});
