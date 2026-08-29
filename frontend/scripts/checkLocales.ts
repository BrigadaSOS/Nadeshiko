#!/usr/bin/env node
/**
 * Two checks over i18n/locales, both cheap and both catching things review does
 * not.
 *
 * PARITY: every locale must expose exactly the same set of leaf keys, so a
 * missing translation can never fall back silently. A key added to en.json alone
 * renders as its own dotted path on /es and /ja.
 *
 * USAGE: every key must be reachable from the source. Dead keys are worse than
 * clutter here -- they are handed to translators, who translate them, for a
 * string nobody will ever render. Thirteen had accumulated by the time this half
 * was written (a whole `hiddenMedia*`/`favoriteMedia*` group left behind by a
 * settings rewrite, and two Anki error strings superseded by
 * `connectFailure.*`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['en', 'es', 'ja'] as const;
const root = fileURLToPath(new URL('../', import.meta.url));
const localesDir = join(root, 'i18n/locales/');

/** Where a key can be referenced from. Locale files themselves are not sources. */
const SOURCE_DIRS = ['app', 'server', 'shared', 'modules', 'content'];

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const keysByLocale = new Map<string, Set<string>>();
for (const locale of LOCALES) {
  const raw = readFileSync(`${localesDir}${locale}.json`, 'utf8');
  keysByLocale.set(locale, new Set(flatten(JSON.parse(raw))));
}

const [reference, ...others] = LOCALES;
const referenceKeys = keysByLocale.get(reference) as Set<string>;

let failed = false;

for (const locale of others) {
  const keys = keysByLocale.get(locale) as Set<string>;
  const missing = [...referenceKeys].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !referenceKeys.has(key));

  if (missing.length || extra.length) {
    failed = true;
    for (const key of missing) console.error(`${locale}.json is missing: ${key}`);
    for (const key of extra) console.error(`${locale}.json has extra:    ${key}`);
  }
}

function readSources(dir: string): string {
  let out = '';
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out += readSources(path);
    else out += `${readFileSync(path, 'utf8')}\n`;
  }
  return out;
}

const sources = SOURCE_DIRS.map((dir) => readSources(join(root, dir))).join('\n');

/**
 * Keys assembled at runtime -- `t(`…motionHint_${preference}`)`,
 * `t(`…activity.types.${type}`)` -- appear in the source only as the literal
 * before the interpolation. Everything under such a prefix counts as reachable.
 *
 * Deliberately generous: a prefix rescues its whole subtree, so the check can
 * miss a dead key but will not invent one. A false "unused" that fails the build
 * on a key someone is about to use would make this check the thing people
 * disable.
 */
const dynamicPrefixes = new Set<string>();
for (const match of sources.matchAll(/`([A-Za-z0-9_.]*?)\$\{/g)) {
  const prefix = match[1];
  if (prefix && (prefix.includes('.') || prefix.includes('_'))) dynamicPrefixes.add(prefix);
}

const unused = [...referenceKeys].filter((key) => {
  if (sources.includes(key)) return false;
  const parent = key.slice(0, key.lastIndexOf('.'));
  for (const prefix of dynamicPrefixes) {
    if (key.startsWith(prefix) || (parent && parent.startsWith(prefix))) return false;
  }
  return true;
});

if (unused.length) {
  failed = true;
  console.error(`\n${unused.length} locale key(s) are not referenced from ${SOURCE_DIRS.join('/')}:`);
  for (const key of unused) console.error(`  ${key}`);
  console.error('\nDelete them from all three locales, or reference them from the code that renders them.');
  console.error('A key built at runtime is recognised by its literal prefix, so `t(`a.b.${x}`)` covers all of a.b.*.');
}

for (const locale of LOCALES) {
  console.log(`${locale}.json: ${(keysByLocale.get(locale) as Set<string>).size} keys`);
}
console.log(`${dynamicPrefixes.size} runtime-assembled key prefixes recognised`);

if (failed) {
  console.error('Locale check FAILED');
  process.exit(1);
}
console.log('Locale check passed: parity and usage');
