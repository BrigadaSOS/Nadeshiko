import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, readFile, stat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The archive of previous builds' `/_nuxt/*` files, and the startup pass that
 * keeps it current.
 *
 * It exists so a reader holding a page from the last deploy can still fetch the
 * chunks that page references. Everything below is about the two ways that goes
 * wrong, and both are worse than not having it:
 *
 *   - PRUNING SOMETHING LIVE. The sweep deletes files, and a file still
 *     referenced by the running build is a broken page for everyone.
 *   - TRUSTING A NAME. The design rests on a content hash naming exactly one
 *     byte sequence, and on 2026-08-13 that turned out to be violable: flipping
 *     `sourcemap.client` between `true` and `'hidden'` changes every chunk's
 *     bytes while changing no chunk's name, because Vite hashes before appending
 *     the `sourceMappingURL` comment. An archived file is served by the ORIGIN
 *     for the whole retention window, so the first version of a name would
 *     outlive the build that corrected it and fail SRI against every later page.
 *
 * Run against a real directory rather than a mocked `fs`: the behaviour under
 * test IS the filesystem's -- `COPYFILE_EXCL`, `mtime`, `ENOENT` from a sibling
 * worker pruning first -- and a mock would be asserting my model of it.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('~~/server/utils/logger', () => ({ logger }));

const BUILD = '7cacf72b-0bb6-48ef-b756-7858e8a1aba7';
const OLD_BUILD = '1a2b3c4d-0bb6-48ef-b756-7858e8a1aba7';

const config = { assetArchiveDir: '', assetArchiveDays: 7 };
vi.stubGlobal('useRuntimeConfig', () => config);
vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin);
// Nitro auto-imports both; the handler itself is exercised by the e2e suite,
// so here it only has to be constructible.
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);

let root: string;
let archiveDir: string;
let sourceDir: string;

/**
 * The h3 stack, as Nitro hands it over.
 *
 * `use` takes the handler alone and h3 normalises it into a layer -- which is
 * exactly why the plugin calls `use` rather than pushing a layer of its own
 * shape, and why this double must not invent a second signature.
 */
function nitroApp() {
  const stack: { route: string; handler: unknown }[] = [{ route: '/', handler: 'nitro-static' }];
  return {
    h3App: {
      stack,
      use: (handler: unknown) => {
        stack.push({ route: '/', handler });
      },
    },
  };
}

/**
 * Runs the plugin and waits for the publish pass it deliberately does not await.
 *
 * Waits on the pass's own completion line rather than on a fixed number of
 * turns: the work is real filesystem I/O, and a turn count that is enough when
 * this test runs alone is not enough when the whole file does -- which shows up
 * as one flaky assertion about a file that simply had not been written yet.
 */
async function run(app = nitroApp()) {
  const plugin = (
    (await import('./03-asset-archive')) as unknown as {
      default: (app: unknown) => Promise<void>;
    }
  ).default;
  await plugin(app);

  // An unconfigured archive intentionally starts no background publish pass.
  if (!config.assetArchiveDir) return app;

  const settled = () =>
    logger.info.mock.calls.some(([, message]) => String(message).includes('publish complete')) ||
    logger.error.mock.calls.some(([, message]) => String(message).includes('staying off')) ||
    logger.error.mock.calls.some((call) => String(call[0]).includes('staying off'));

  const deadline = Date.now() + 10_000;
  while (!settled() && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(settled(), 'asset archive publish did not settle within 10 seconds').toBe(true);
  return app;
}

/** Writes a file into the running build's output. */
async function liveAsset(name: string, contents = 'live', build = BUILD) {
  await mkdir(join(sourceDir, build), { recursive: true });
  await writeFile(join(sourceDir, build, name), contents);
}

/** Writes a file into the archive, optionally aged by `daysAgo`. */
async function archived(name: string, contents = 'old', build = BUILD, daysAgo = 0) {
  await mkdir(join(archiveDir, build), { recursive: true });
  const file = join(archiveDir, build, name);
  await writeFile(file, contents);
  if (daysAgo > 0) {
    const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await utimes(file, when, when);
  }
  return file;
}

const archiveNames = async (build = BUILD) => {
  try {
    return (await readdir(join(archiveDir, build))).sort();
  } catch {
    return [];
  }
};

const exists = async (path: string) => !!(await stat(path).catch(() => null));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  root = await mkdtemp(join(tmpdir(), 'nd-archive-'));
  archiveDir = join(root, 'archive');
  sourceDir = join(root, '.output/public/_nuxt');
  await mkdir(archiveDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  config.assetArchiveDir = archiveDir;
  config.assetArchiveDays = 7;
  vi.spyOn(process, 'cwd').mockReturnValue(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('staying off when it cannot work', () => {
  test('does nothing at all when no archive is configured', async () => {
    // And says nothing either: not configuring one is the ordinary state in
    // dev and staging, so an error line every boot is noise that trains people
    // to ignore the ones that matter.
    config.assetArchiveDir = '';

    const app = await run();

    expect(app.h3App.stack).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('refuses a MISSING archive directory rather than making one', async () => {
    // A missing mount would otherwise be papered over with a container-local
    // directory that works perfectly until the container is replaced -- which
    // is exactly when this is supposed to help.
    config.assetArchiveDir = join(root, 'not-mounted');

    const app = await run();

    expect(app.h3App.stack).toHaveLength(1);
    expect(await exists(join(root, 'not-mounted'))).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('unavailable'));
  });

  test('refuses a path that is a file', async () => {
    config.assetArchiveDir = join(root, 'a-file');
    await writeFile(config.assetArchiveDir, 'not a directory');

    const app = await run();

    expect(app.h3App.stack).toHaveLength(1);
  });

  test('refuses when the running build cannot be listed', async () => {
    // Without knowing what is live, the prune below has no idea what it may
    // delete.
    await rm(sourceDir, { recursive: true, force: true });

    const app = await run();

    expect(app.h3App.stack).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('staying off'));
  });
});

describe('the request handler', () => {
  test('goes at the FRONT of the stack, ahead of Nitro’s static handler', async () => {
    // Behind it this never runs at all: on a miss under `/_nuxt/` the static
    // handler throws a 404 rather than falling through.
    await liveAsset('a.js');

    const app = await run();

    expect(app.h3App.stack).toHaveLength(2);
    expect(app.h3App.stack[0]!.handler).not.toBe('nitro-static');
    expect(app.h3App.stack[1]!.handler).toBe('nitro-static');
  });

  test('moves only its own layer to the front and preserves existing handler order', async () => {
    await liveAsset('a.js');
    const app = nitroApp();
    app.h3App.stack.push({ route: '/', handler: 'second-existing-handler' });

    await run(app);

    expect(app.h3App.stack.map((layer) => layer.handler)).toEqual([
      expect.anything(),
      'nitro-static',
      'second-existing-handler',
    ]);
    expect(app.h3App.stack[0]!.handler).not.toBe('nitro-static');
    expect(app.h3App.stack[0]!.handler).not.toBe('second-existing-handler');
  });

  test('stays off when the stack is not the shape it expects', async () => {
    // "Appended" is not a lesser version of "prepended" here, so the honest
    // outcome is the archive staying off with a line in the log.
    await liveAsset('a.js');
    const broken = { h3App: {} };

    await run(broken as never);

    expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('serving'));
  });
});

describe('publishing the running build', () => {
  test('copies the build’s assets into the archive', async () => {
    await liveAsset('a.js');
    await liveAsset('b.css');

    await run();

    expect(await archiveNames()).toEqual(['a.js', 'b.css']);
  });

  test('keeps each build in its own segment, so two builds never collide', async () => {
    await liveAsset('a.js', 'from-new', BUILD);
    await liveAsset('a.js', 'from-old', OLD_BUILD);

    await run();

    expect(await readFile(join(archiveDir, BUILD, 'a.js'), 'utf8')).toBe('from-new');
    expect(await readFile(join(archiveDir, OLD_BUILD, 'a.js'), 'utf8')).toBe('from-old');
  });

  test('leaves sourcemaps out, which are 85% of the bytes and unreachable', async () => {
    // Asserted on what was COPIED as well as on what survives: the prune below
    // would delete a stray sourcemap on the same pass, so the end state alone
    // cannot tell "never copied" from "copied and swept up" -- and the whole
    // point is not writing 85% of a build to the volume in the first place.
    await liveAsset('a.js');
    await liveAsset('a.js.map', '{"version":3}');

    await run();

    expect(await archiveNames()).toEqual(['a.js']);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ copied: 1 }),
      expect.stringContaining('publish complete'),
    );
  });

  test('ignores a directory in the output that is not a build', async () => {
    // The build's own `builds/` manifest folder sits inside the segment; a
    // directory at this level is not an asset.
    await liveAsset('a.js');
    await mkdir(join(sourceDir, 'not-a-build-id'), { recursive: true });
    await writeFile(join(sourceDir, 'not-a-build-id', 'x.js'), 'x');

    await run();

    expect(await exists(join(archiveDir, 'not-a-build-id'))).toBe(false);
  });
});

describe('an asset the archive already holds', () => {
  test('with the SAME bytes is kept, not re-copied', async () => {
    await liveAsset('a.js', 'same');
    await archived('a.js', 'same');

    await run();

    expect(await readFile(join(archiveDir, BUILD, 'a.js'), 'utf8')).toBe('same');
  });

  test('is re-stamped, which is what keeps a long-lived chunk out of the prune', async () => {
    // A chunk unchanged across many builds would otherwise age out of the
    // archive while still being live.
    await liveAsset('a.js', 'same');
    const file = await archived('a.js', 'same', BUILD, 30);

    await run();

    const info = await stat(file);
    expect(Date.now() - info.mtimeMs).toBeLessThan(60_000);
  });

  test('with DIFFERENT bytes is replaced, and the running build wins', async () => {
    // One name, two byte sequences: the archived copy would outlive the build
    // that corrected it and fail SRI against every later page that references
    // it.
    await liveAsset('a.js', 'corrected-bytes');
    await archived('a.js', 'stale-bytes');

    await run();

    expect(await readFile(join(archiveDir, BUILD, 'a.js'), 'utf8')).toBe('corrected-bytes');
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('no longer match'));
  });
});

describe('pruning', () => {
  test('deletes an archived asset past its retention that nothing live references', async () => {
    await liveAsset('new.js');
    await archived('gone.js', 'old', OLD_BUILD, 30);

    await run();

    expect(await archiveNames(OLD_BUILD)).toEqual([]);
  });

  test('keeps one that is still within the window', async () => {
    await liveAsset('new.js');
    await archived('recent.js', 'old', OLD_BUILD, 2);

    await run();

    expect(await archiveNames(OLD_BUILD)).toEqual(['recent.js']);
  });

  test('NEVER deletes a file the running build still references, however old', async () => {
    // The failure that takes the whole site down: a live chunk deleted from the
    // origin is a broken page for everyone on the current build.
    await liveAsset('a.js', 'same');
    await archived('a.js', 'same', BUILD, 400);

    await run();

    expect(await archiveNames()).toContain('a.js');
  });

  test('deletes a sourcemap regardless of age, since nothing can ask for it', async () => {
    // Waiting out the retention window on 10MB of files nothing can request is
    // just a slower way of keeping them.
    await liveAsset('a.js');
    await archived('old.js.map', '{"version":3}', OLD_BUILD, 1);

    await run();

    expect(await archiveNames(OLD_BUILD)).toEqual([]);
  });

  test('leaves a file the SERVING allowlist rejects alone, however old', async () => {
    // The same allowlist that decides what may be served, reused so this pass
    // can only ever delete files this module could have written. A name with a
    // space in it could never have been one of ours.
    await liveAsset('a.js');
    await mkdir(join(archiveDir, OLD_BUILD), { recursive: true });
    const stray = join(archiveDir, OLD_BUILD, 'ops notes.txt');
    await writeFile(stray, 'someone left this here');
    const when = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await utimes(stray, when, when);

    await run();

    expect(await archiveNames(OLD_BUILD)).toEqual(['ops notes.txt']);
  });

  test('sweeps away the flat files from before builds had their own segment', async () => {
    // Nothing can request them: the served path now requires a build segment,
    // so they are unreachable bytes on a volume rather than a retention
    // question.
    await liveAsset('a.js');
    await writeFile(join(archiveDir, 'legacy.CylgXoQM.js'), 'from before');

    await run();

    expect(await exists(join(archiveDir, 'legacy.CylgXoQM.js'))).toBe(false);
  });

  test('but not a stray file someone left in the archive root', async () => {
    await liveAsset('a.js');
    await writeFile(join(archiveDir, 'notes for ops.txt'), 'do not delete');

    await run();

    expect(await exists(join(archiveDir, 'notes for ops.txt'))).toBe(true);
  });

  test('reports what it did, so a volume filling up is visible', async () => {
    await liveAsset('a.js');

    await run();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ copied: 1, pruned: expect.any(Number) }),
      expect.stringContaining('publish complete'),
    );
  });
});
