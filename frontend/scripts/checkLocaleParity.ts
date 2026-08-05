#!/usr/bin/env bun
/**
 * Fails when the locale files drift apart: every locale must expose exactly the
 * same set of leaf keys, so a missing translation can never fall back silently.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCALES = ['en', 'es', 'ja'] as const;
const localesDir = fileURLToPath(new URL('../i18n/locales/', import.meta.url));

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

for (const locale of LOCALES) {
  console.log(`${locale}.json: ${(keysByLocale.get(locale) as Set<string>).size} keys`);
}

if (failed) {
  console.error('Locale key parity check FAILED');
  process.exit(1);
}
console.log('Locale key parity check passed');
