// Verify final asset bytes against the SRI digests advertised by the server bundle. PostHog can mutate JS
// after nuxt-security hashes it, leaving a healthy but unhydratable site. This image-build check covers
// production-only mutations that staging never executes.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUTPUT = resolve(process.cwd(), '.output');
const SERVER_DIR = join(OUTPUT, 'server');
const PUBLIC_DIR = join(OUTPUT, 'public');

// Brace-match the serialized sriHashes object; stopping at the first }; can truncate the map.
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

// Locate the generated hash map rather than coupling the check to Nuxt's internal chunk filename.
async function findServerBundle() {
  const files = await readdir(SERVER_DIR, { recursive: true }).catch(() => []);
  for (const file of files) {
    if (!file.endsWith('.mjs')) continue;
    const source = await readFile(join(SERVER_DIR, file), 'utf8');
    if (/const sriHashes\s*=\s*\{/.test(source)) return source;
  }
  return null;
}

const bundle = await findServerBundle();
if (!bundle) {
  console.error(`verify-sri: no server bundle with sriHashes under ${SERVER_DIR}`);
  process.exit(1);
}

const hashes = extractHashes(bundle);

// Fail closed if an upgrade changes/removes the map; verifying zero assets is not a pass.
if (!hashes || Object.keys(hashes).length === 0) {
  console.error("verify-sri: could not read nuxt-security's sriHashes from the server bundle");
  console.error('verify-sri: refusing to pass a build whose integrity cannot be checked');
  process.exit(1);
}

// Nuxt fetches build manifests without integrity attributes and rewrites them after hashing. Exclude only
// this directory, not arbitrary JSON assets. It sits under the per-build buildAssetsDir: /_nuxt/<build>/builds/.
const UNENFORCED = /^\/_nuxt\/[0-9a-f-]{36}\/builds\//;

const mismatched = [];
const missing = [];
let checked = 0;

for (const [path, declared] of Object.entries(hashes)) {
  if (UNENFORCED.test(path)) continue;

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

// PostHog deletes uploaded source maps; absent hashed files have no document SRI reference and do not fail.
if (missing.length > 0) {
  console.log(`verify-sri: ${missing.length} hashed file(s) absent from the build (not an error)`);
}

if (mismatched.length > 0) {
  console.error(
    `verify-sri: ${mismatched.length} of ${checked + mismatched.length} assets do NOT match their integrity digest.`,
  );
  console.error('verify-sri: every browser would block these. Something rewrote them after nuxt-security hashed them.');
  for (const { path, expected, actual } of mismatched.slice(0, 10)) {
    console.error(`  ${path}\n    declared ${expected}\n    actual   ${actual}`);
  }
  if (mismatched.length > 10) console.error(`  ... and ${mismatched.length - 10} more`);
  process.exit(1);
}

console.log(`verify-sri: ${checked} assets match their integrity digests`);
