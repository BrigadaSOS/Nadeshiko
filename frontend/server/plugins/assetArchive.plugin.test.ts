import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Serving `/_nuxt/*` files from previous builds.
 *
 * `server/utils/assetArchive.ts` has its own tests for the naming and expiry
 * rules; what is untested is this plugin -- the request handler and the startup
 * pass -- and it holds three decisions that are each invisible when wrong:
 *
 * THE HANDLER MUST BE FIRST. Nitro's public-asset handler is the first layer of
 * the request stack and on a `/_nuxt/` miss it 404s rather than falling through,
 * so a handler appended behind it never runs at all. That is why `install`
 * refuses rather than settling for "appended": staying off with a line in the
 * log is honest, and silently doing nothing is not.
 *
 * A MISS MUST SAY `no-store`. Nitro's own miss path removes `Cache-Control`
 * entirely, and an asset 404 that says nothing about caching is one Cloudflare
 * applies the zone's one-hour browser minimum to -- so a reader who lost a race
 * with a deploy pins the 404 in their own cache and keeps failing for an hour
 * after the file is back.
 *
 * THE ARCHIVE DIRECTORY IS NEVER CREATED. A missing mount papered over with a
 * container-local directory works perfectly until the container is replaced,
 * which is exactly when this is supposed to help.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('~~/server/utils/logger', () => ({ logger }));

let runtimeConfig: { assetArchiveDir?: string; assetArchiveDays?: number } = {};

vi.stubGlobal('defineNitroPlugin', (fn: unknown) => fn);
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);
vi.stubGlobal('setResponseStatus', (event: FakeEvent, status: number) => {
  event.status = status;
});
vi.stubGlobal('setResponseHeader', (event: FakeEvent, name: string, value: unknown) => {
  event.headers[name] = value;
});
// The body is a file stream; these cases assert the headers and the status, so
// it is enough to know a stream was handed over. The error handler matters: the
// stream opens the file asynchronously, and by then `afterEach` has removed the
// temp directory -- an unhandled ENOENT there would fail the run from outside
// any test.
vi.stubGlobal('sendStream', (_event: FakeEvent, stream: unknown) => {
  const readable = stream as { on: (event: string, fn: () => void) => void; destroy?: () => void };
  readable.on('error', () => {});
  readable.destroy?.();
  return 'stream';
});

type FakeEvent = { method: string; path: string; status?: number; headers: Record<string, unknown> };

/** A request as the handler receives it. */
function makeEvent(path: string, method = 'GET'): FakeEvent {
  return { method, path, headers: {} };
}

/** A nitro app whose h3 stack behaves like the real one. */
function fakeNitroApp() {
  const stack: unknown[] = [{ route: '/', handler: 'nitro-static' }];
  return {
    h3App: {
      stack,
      use: (handler: unknown) => stack.push({ route: '/', handler }),
    },
  };
}

/**
 * The archive handler, if the plugin installed one at the front.
 *
 * Nitro's own layer is a string in this double, so "the first handler is a
 * function" is exactly "the archive handler is first" -- which is the property
 * the plugin exists to guarantee.
 */
function installedHandler(app: ReturnType<typeof fakeNitroApp>) {
  const first = app.h3App.stack[0] as { handler?: unknown };
  return typeof first?.handler === 'function' ? (first.handler as (event: FakeEvent) => Promise<unknown>) : undefined;
}

/**
 * Build segments are UUIDs, matched strictly -- that pattern is what keeps
 * `builds/**` (Nuxt's own manifest, served with `maxAge: 1`) out of the archive,
 * so a loose stand-in here would exercise a rule the app does not have.
 */
const LIVE_BUILD = '11111111-1111-4111-8111-111111111111';
const OLD_BUILD = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_BUILD = '99999999-9999-4999-8999-999999999999';

let workDir: string;
let archiveDir: string;
let originalCwd: string;

/** Writes a file into the running build's asset directory. */
function writeLiveAsset(buildId: string, name: string, body = 'live') {
  const dir = join(workDir, '.output/public/_nuxt', buildId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

/** Writes a file into the archive, as a previous container would have. */
function writeArchivedAsset(buildId: string, name: string, body = 'archived') {
  const dir = join(archiveDir, buildId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

/** Boots the plugin against the current directories. */
async function boot(app = fakeNitroApp()) {
  vi.resetModules();
  const plugin = (await import('./03-asset-archive')).default as (a: unknown) => Promise<void>;
  await plugin(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), 'nd-archive-work-'));
  archiveDir = mkdtempSync(join(tmpdir(), 'nd-archive-store-'));
  process.chdir(workDir);
  runtimeConfig = { assetArchiveDir: archiveDir, assetArchiveDays: 7 };
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(archiveDir, { recursive: true, force: true });
});

describe('staying off', () => {
  test('does nothing when no archive directory is configured', async () => {
    runtimeConfig = {};

    const app = await boot();

    expect(installedHandler(app)).toBeUndefined();
  });

  test('stays off when there is no built output to read', async () => {
    // `nuxt dev` and a test run: there is no `.output`, and dev rebuilds chunks
    // constantly with no deploy to survive.
    const app = await boot();

    expect(installedHandler(app)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('staying off'));
  });

  test('stays off, rather than creating one, when the archive directory is missing', async () => {
    // A missing mount papered over with a container-local directory works
    // perfectly until the container is replaced.
    writeLiveAsset(LIVE_BUILD, 'entry.abc123.js');
    runtimeConfig = { assetArchiveDir: join(workDir, 'not-mounted'), assetArchiveDays: 7 };

    const app = await boot();

    expect(installedHandler(app)).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ assetArchiveDir: expect.any(String) }),
      expect.stringContaining('directory unavailable'),
    );
  });

  test('stays off when the archive path is a file rather than a directory', async () => {
    writeLiveAsset(LIVE_BUILD, 'entry.abc123.js');
    const notADir = join(workDir, 'archive-file');
    writeFileSync(notADir, '');
    runtimeConfig = { assetArchiveDir: notADir, assetArchiveDays: 7 };

    const app = await boot();

    expect(installedHandler(app)).toBeUndefined();
  });

  test('stays off when the request stack cannot be reached', async () => {
    // "Appended" is not a lesser version of "prepended": behind Nitro's static
    // handler this never runs at all.
    writeLiveAsset(LIVE_BUILD, 'entry.abc123.js');

    const app = { h3App: undefined } as never;
    vi.resetModules();
    const plugin = (await import('./03-asset-archive')).default as (a: unknown) => Promise<void>;
    await plugin(app);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cannot reach the request stack'));
  });
});

describe('installation', () => {
  test('puts the handler at the FRONT of the stack, ahead of Nitro’s static one', async () => {
    writeLiveAsset(LIVE_BUILD, 'entry.abc123.js');

    const app = await boot();

    expect(installedHandler(app)).toBeInstanceOf(Function);
    expect((app.h3App.stack.at(-1) as { handler: unknown }).handler).toBe('nitro-static');
  });

  test('says it is on, and how much it is holding', async () => {
    writeLiveAsset(LIVE_BUILD, 'entry.abc123.js');
    writeLiveAsset(LIVE_BUILD, 'chunk.def456.js');

    await boot();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ liveAssets: 2, retentionDays: 7 }),
      expect.stringContaining('serving superseded builds'),
    );
  });

  test('ignores directories that are not build segments', async () => {
    // There are none today beyond the build's own manifest folder, which sits
    // inside the build segment -- walking them would be guessing.
    writeLiveAsset(LIVE_BUILD, 'entry.abc123.js');
    mkdirSync(join(workDir, '.output/public/_nuxt', 'not-a-build!'), { recursive: true });
    writeFileSync(join(workDir, '.output/public/_nuxt', 'not-a-build!', 'x.js'), '');

    await boot();

    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ liveAssets: 1 }), expect.any(String));
  });
});

describe('the request handler', () => {
  /** Boots with one live asset and returns the installed handler. */
  async function handlerWith(live: [string, string][] = [[LIVE_BUILD, 'entry.abc123.js']]) {
    for (const [build, name] of live) writeLiveAsset(build, name);
    const app = await boot();
    const handler = installedHandler(app);
    if (!handler) throw new Error('the plugin did not install a handler');
    return handler;
  }

  test('passes through anything that is not a GET or HEAD', async () => {
    // Runs for every request the server takes, so the cheapest test comes first.
    const handler = await handlerWith();

    expect(await handler(makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js`, 'POST'))).toBeUndefined();
  });

  test('answers a HEAD as well as a GET', async () => {
    writeArchivedAsset(OLD_BUILD, 'old.abc123.js');
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js`, 'HEAD');
    await handler(event);

    expect(event.headers['X-Nd-Asset']).toBe('archive');
  });

  test('passes through a path outside /_nuxt/', async () => {
    const handler = await handlerWith();

    expect(await handler(makeEvent('/en/search/neko'))).toBeUndefined();
  });

  test('passes through a live asset, so Nitro answers it with etags and 304s', async () => {
    // The running build has it, and Nitro's own handler does the etag,
    // conditional-request and precompressed-variant work this does not
    // reimplement.
    const handler = await handlerWith([[LIVE_BUILD, 'entry.abc123.js']]);

    expect(await handler(makeEvent(`/_nuxt/${LIVE_BUILD}/entry.abc123.js`))).toBeUndefined();
  });

  test('serves a superseded build’s asset from the archive', async () => {
    writeArchivedAsset(OLD_BUILD, 'old.abc123.js', 'archived body');
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js`);
    const body = await handler(event);

    expect(body).toBeDefined();
    expect(event.headers['X-Nd-Asset']).toBe('archive');
  });

  test('marks an archived response so it can be confirmed with curl', async () => {
    // The one externally visible sign that a reader is still on an older build.
    writeArchivedAsset(OLD_BUILD, 'old.abc123.js');
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js`);
    await handler(event);

    expect(event.headers['X-Nd-Asset']).toBe('archive');
  });

  test('caches an archived asset forever, because its name is a content hash', async () => {
    writeArchivedAsset(OLD_BUILD, 'old.abc123.js');
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js`);
    await handler(event);

    expect(event.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  test('sends the length and a content type', async () => {
    writeArchivedAsset(OLD_BUILD, 'old.abc123.js', 'abc');
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js`);
    await handler(event);

    expect(event.headers['Content-Length']).toBe(3);
    expect(String(event.headers['Content-Type'])).toContain('javascript');
  });

  test('a miss says `no-store`, which is the difference between a bad second and a bad hour', async () => {
    // Nitro's miss path removes `Cache-Control` entirely, and Cloudflare then
    // applies the zone's one-hour browser minimum -- so a reader who lost a race
    // with a deploy pins the 404 in their own cache.
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${UNKNOWN_BUILD}/never-existed.abc123.js`);
    await handler(event);

    expect(event.status).toBe(404);
    expect(event.headers['Cache-Control']).toBe('no-store');
  });

  test('passes through an asset kind that is never archived', async () => {
    // The live one has to stay reachable, which means handing the request back
    // to Nitro rather than 404ing it as a miss.
    const handler = await handlerWith();

    expect(await handler(makeEvent(`/_nuxt/${LIVE_BUILD}/builds/meta/abc.json`))).toBeUndefined();
  });

  test('ignores a query string when resolving the name', async () => {
    writeArchivedAsset(OLD_BUILD, 'old.abc123.js');
    const handler = await handlerWith();

    const event = makeEvent(`/_nuxt/${OLD_BUILD}/old.abc123.js?v=2`);
    await handler(event);

    expect(event.headers['X-Nd-Asset']).toBe('archive');
  });

  test('passes through a path that does not look like an asset at all', async () => {
    const handler = await handlerWith();

    expect(await handler(makeEvent('/_nuxt/'))).toBeUndefined();
  });
});
