/**
 * Fails the build if any asset's bytes no longer match the Subresource
 * Integrity digest the HTML will advertise for it.
 *
 * WHY THIS EXISTS. On 2026-08-13 a production release rendered nadeshiko.co
 * inert: 37 of 41 scripts were blocked by the browser, the page arrived from SSR
 * and never hydrated, and every click did nothing. The cause was an ordering
 * accident between two modules that never meet in a test:
 *
 *   nuxt-security  hashes the built assets at `nitro:build:before`
 *   @posthog/nuxt  injects a chunk id into every JS file at
 *                  `nitro:build:public-assets`, which fires AFTER
 *
 * So every digest described the file as it was one step earlier in the build.
 * Nothing downstream could notice: the deploy succeeded, the container was
 * healthy, `/up` answered, and the HTML and assets were both "current" -- they
 * simply disagreed about the bytes.
 *
 * It could not be caught on staging either, and that is the part worth fixing
 * rather than remembering. `@posthog/nuxt` is gated on `isProd`, staging builds
 * with `NUXT_PUBLIC_ENVIRONMENT=development`, so the injection never runs
 * there. Staging was green because it had never executed the code path that
 * breaks.
 *
 * A check that runs inside the image build has neither problem. It sees whatever
 * the build actually produced, in every environment, before anything is
 * deployed -- and it fails on ANY post-hash mutation, not just this one. The
 * sourcemap-comment flip that broke staging earlier the same day is the same
 * class of fault and would also be caught here.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUTPUT = resolve(process.cwd(), '.output');
const SERVER_BUNDLE = join(OUTPUT, 'server/chunks/nitro/nitro.mjs');
const PUBLIC_DIR = join(OUTPUT, 'public');

/**
 * Pulls the `const sriHashes = {...}` object nuxt-security serialises into the
 * server bundle.
 *
 * Brace-matched rather than regex-terminated: the object is a single line of
 * JSON hundreds of entries long, and "up to the first `};`" is the kind of
 * shortcut that quietly truncates and then passes.
 */
function extractHashes(source) {
  const marker = /const sriHashes\s*=\s*\{/.exec(source);
  if (!marker) return null;

  const start = source.indexOf('{', marker.index);
  let depth = 0;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }

  return null;
}

const bundle = await readFile(SERVER_BUNDLE, 'utf8').catch(() => null);
if (!bundle) {
  console.error(`verify-sri: no server bundle at ${SERVER_BUNDLE}`);
  process.exit(1);
}

const hashes = extractHashes(bundle);

// NOT a pass. If nuxt-security stops emitting this map -- renamed, restructured,
// removed -- the check silently verifies nothing, which is worse than not having
// it, because the build still goes green.
if (!hashes || Object.keys(hashes).length === 0) {
  console.error('verify-sri: could not read nuxt-security\'s sriHashes from the server bundle');
  console.error('verify-sri: refusing to pass a build whose integrity cannot be checked');
  process.exit(1);
}

/**
 * The app manifest is hashed and then rewritten, and that is fine.
 *
 * `/_nuxt/builds/latest.json` and `builds/meta/<build-id>.json` are Nuxt's own
 * record of which build is live. Nothing loads them through a tag carrying an
 * `integrity` attribute -- the client `$fetch`es them -- so a digest that no
 * longer matches cannot block anything, and the browser never checks. Verified
 * against production, where the manifest has always mismatched while every
 * document-referenced asset matched.
 *
 * Scoped to this one directory on purpose. A blanket "ignore JSON" would also
 * excuse a real asset, and the value of this check is that it has no exceptions
 * worth arguing about.
 */
const UNENFORCED = '/_nuxt/builds/';

const mismatched = [];
const missing = [];
let checked = 0;

for (const [path, declared] of Object.entries(hashes)) {
  if (path.startsWith(UNENFORCED)) continue;

  const [algorithm, expected] = declared.split('-');
  const file = join(PUBLIC_DIR, path.replace(/^\//, ''));

  const bytes = await readFile(file).catch(() => null);
  if (!bytes) {
    missing.push(path);
    continue;
  }

  const actual = createHash(algorithm).update(bytes).digest('base64');
  checked++;

  if (actual !== expected) mismatched.push({ path, expected, actual });
}

// Missing files are reported but do not fail: `@posthog/nuxt` deletes sourcemaps
// after uploading them, and a hashed-then-deleted `.map` breaks nothing -- no
// document references one with an integrity attribute.
if (missing.length > 0) {
  console.log(`verify-sri: ${missing.length} hashed file(s) absent from the build (not an error)`);
}

if (mismatched.length > 0) {
  console.error(`verify-sri: ${mismatched.length} of ${checked + mismatched.length} assets do NOT match their integrity digest.`);
  console.error('verify-sri: every browser would block these. Something rewrote them after nuxt-security hashed them.');
  for (const { path, expected, actual } of mismatched.slice(0, 10)) {
    console.error(`  ${path}\n    declared ${expected}\n    actual   ${actual}`);
  }
  if (mismatched.length > 10) console.error(`  ... and ${mismatched.length - 10} more`);
  process.exit(1);
}

console.log(`verify-sri: ${checked} assets match their integrity digests`);
