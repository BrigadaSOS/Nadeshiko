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
const ROOT_DIR = join(__dirname, '..');
const BACKEND_PACKAGE_JSON_PATH = join(ROOT_DIR, 'backend', 'package.json');
const FRONTEND_PACKAGE_JSON_PATH = join(ROOT_DIR, 'frontend', 'package.json');
const OPENAPI_PATH = join(ROOT_DIR, 'backend', 'docs', 'openapi', 'openapi.yaml');

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

function readPackageJson(path: string, label: string): PackageJson {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Failed to read ${label}: ${message}`);
  }
}

function readPackageVersion(path: string, label: string): string {
  const pkg = readPackageJson(path, label);
  return normalizeVersion(pkg.version, `${label} version`);
}

function writePackageVersion(path: string, label: string, version: string): string {
  const pkg = readPackageJson(path, label);
  const rawCurrent = String(pkg.version ?? '').trim();
  const previous = rawCurrent ? normalizeVersion(rawCurrent, `${label} version`) : '(missing)';

  if (previous === version) return previous;

  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  return previous;
}

function readOpenApiLines(): string[] {
  return readFileSync(OPENAPI_PATH, 'utf8').split('\n');
}

function getOpenApiVersionIndex(lines: string[]): number {
  const infoIndex = lines.findIndex((line) => line.trim() === 'info:');
  if (infoIndex === -1) fail('Could not find `info:` block in backend/docs/openapi/openapi.yaml');

  for (let i = infoIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (/^ {2}version:\s*/.test(line)) return i;
  }

  fail('Could not find `info.version` in backend/docs/openapi/openapi.yaml');
}

function readOpenApiVersion(): string {
  const lines = readOpenApiLines();
  const versionLine = lines[getOpenApiVersionIndex(lines)] ?? '';
  const rawVersion = versionLine.replace(/^ {2}version:\s*/, '').trim();
  return normalizeVersion(rawVersion, 'backend/docs/openapi/openapi.yaml info.version');
}

function writeOpenApiVersion(version: string): string {
  const lines = readOpenApiLines();
  const versionIndex = getOpenApiVersionIndex(lines);
  const currentLine = lines[versionIndex] ?? '';
  const previous = normalizeVersion(
    currentLine.replace(/^ {2}version:\s*/, '').trim(),
    'backend/docs/openapi/openapi.yaml info.version',
  );

  if (previous === version) return previous;

  lines[versionIndex] = `  version: ${version}`;
  writeFileSync(OPENAPI_PATH, `${lines.join('\n')}\n`);
  return previous;
}

function runSet(versionInput: unknown): void {
  const version = normalizeVersion(versionInput, 'target version');

  const previousBackendVersion = writePackageVersion(
    BACKEND_PACKAGE_JSON_PATH,
    'backend/package.json',
    version,
  );
  const previousFrontendVersion = writePackageVersion(
    FRONTEND_PACKAGE_JSON_PATH,
    'frontend/package.json',
    version,
  );
  const previousOpenApiVersion = writeOpenApiVersion(version);

  console.log(`backend/package.json: ${previousBackendVersion} -> ${version}`);
  console.log(`frontend/package.json: ${previousFrontendVersion} -> ${version}`);
  console.log(`backend/docs/openapi/openapi.yaml: ${previousOpenApiVersion} -> ${version}`);
  console.log(`Next: git commit + git tag -a v${version} -m "Release v${version}"`);
}

function runCheck(expectedInput?: unknown): void {
  const expected =
    expectedInput == null || String(expectedInput).trim() === ''
      ? undefined
      : normalizeVersion(expectedInput, 'expected version');

  const backendVersion = readPackageVersion(BACKEND_PACKAGE_JSON_PATH, 'backend/package.json');
  const frontendVersion = readPackageVersion(FRONTEND_PACKAGE_JSON_PATH, 'frontend/package.json');
  const openApiVersion = readOpenApiVersion();

  if (expected && backendVersion !== expected) {
    fail(`backend/package.json version (${backendVersion}) does not match expected version (${expected})`);
  }

  if (frontendVersion !== backendVersion) {
    fail(
      `frontend/package.json version (${frontendVersion}) does not match backend/package.json (${backendVersion})`,
    );
  }

  if (openApiVersion !== backendVersion) {
    fail(
      `backend/docs/openapi/openapi.yaml info.version (${openApiVersion}) does not match backend/package.json (${backendVersion})`,
    );
  }

  console.log(`Version check OK: ${backendVersion}`);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/releaseVersion.ts <set|check> [version]');
  console.log('  set <version>   Update backend/package.json, frontend/package.json and backend/docs/openapi/openapi.yaml');
  console.log('  check [version] Validate all version targets are in sync');
}

function main(): void {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'set') {
    if (!arg) fail('Missing version. Usage: bun run scripts/releaseVersion.ts set <version>');
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
