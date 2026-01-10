#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PackageJson = {
  version?: unknown;
  [key: string]: unknown;
};

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_DIR = join(__dirname, '..');
const PACKAGE_JSON_PATH = join(BACKEND_DIR, 'package.json');
const OPENAPI_PATH = join(BACKEND_DIR, 'docs/openapi/openapi.yaml');

function fail(message: string): never {
  console.error(`releaseVersion failed: ${message}`);
  process.exit(1);
}

function normalizeVersion(value: unknown, label: string): string {
  const version = String(value ?? '').trim();
  if (!version) fail(`${label} is missing.`);
  if (!SEMVER_REGEX.test(version)) fail(`${label} must be semver. Received: "${version}"`);
  return version;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as PackageJson;
}

function writePackageVersion(version: string): string {
  const pkg = readPackageJson();
  const previous = normalizeVersion(pkg.version, 'backend/package.json version');
  if (previous === version) return previous;
  pkg.version = version;
  writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  return previous;
}

function readOpenApiLines(): string[] {
  return readFileSync(OPENAPI_PATH, 'utf8').split('\n');
}

function getOpenApiVersionIndex(lines: string[]): number {
  const infoIndex = lines.findIndex(line => line.trim() === 'info:');
  if (infoIndex === -1) fail('Could not find `info:` block in docs/openapi/openapi.yaml');

  for (let i = infoIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (/^  version:\s*/.test(line)) return i;
  }

  fail('Could not find `info.version` in docs/openapi/openapi.yaml');
}

function readOpenApiVersion(): string {
  const lines = readOpenApiLines();
  const versionLine = lines[getOpenApiVersionIndex(lines)] ?? '';
  const rawVersion = versionLine.replace(/^  version:\s*/, '').trim();
  return normalizeVersion(rawVersion, 'docs/openapi/openapi.yaml info.version');
}

function writeOpenApiVersion(version: string): string {
  const lines = readOpenApiLines();
  const versionIndex = getOpenApiVersionIndex(lines);
  const currentLine = lines[versionIndex] ?? '';
  const previous = normalizeVersion(
    currentLine.replace(/^  version:\s*/, '').trim(),
    'docs/openapi/openapi.yaml info.version',
  );

  if (previous === version) return previous;

  lines[versionIndex] = `  version: ${version}`;
  writeFileSync(OPENAPI_PATH, `${lines.join('\n')}\n`);
  return previous;
}

function runSet(versionInput: unknown): void {
  const version = normalizeVersion(versionInput, 'target version');
  const previousPackageVersion = writePackageVersion(version);
  const previousOpenApiVersion = writeOpenApiVersion(version);

  console.log(`backend/package.json: ${previousPackageVersion} -> ${version}`);
  console.log(`docs/openapi/openapi.yaml: ${previousOpenApiVersion} -> ${version}`);
  console.log(`Next: git commit + git tag -a v${version} -m "Backend v${version}"`);
}

function runCheck(expectedInput?: unknown): void {
  const expected =
    expectedInput == null || String(expectedInput).trim() === ''
      ? undefined
      : normalizeVersion(expectedInput, 'expected version');

  const packageVersion = normalizeVersion(
    readPackageJson().version,
    'backend/package.json version',
  );
  const openApiVersion = readOpenApiVersion();

  if (expected && packageVersion !== expected) {
    fail(`backend/package.json version (${packageVersion}) does not match expected version (${expected})`);
  }

  if (openApiVersion !== packageVersion) {
    fail(
      `docs/openapi/openapi.yaml info.version (${openApiVersion}) does not match backend/package.json (${packageVersion})`,
    );
  }

  console.log(`Version check OK: ${packageVersion}`);
}

function printUsage(): void {
  console.log('Usage: bun run bin/releaseVersion.ts <set|check> [version]');
  console.log('  set <version>   Update backend/package.json and docs/openapi/openapi.yaml');
  console.log('  check [version] Validate that backend/package.json and docs/openapi/openapi.yaml match');
}

function main(): void {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'set') {
    if (!arg) fail('Missing version. Usage: bun run bin/releaseVersion.ts set <version>');
    runSet(arg);
    return;
  }

  if (command === 'check') {
    runCheck(arg);
    return;
  }

  fail(`Unknown command: ${command}`);
}

main();
