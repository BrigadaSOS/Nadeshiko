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
const OPENAPI_GENERATED_PATH = join(ROOT_DIR, 'backend', 'docs', 'generated', 'openapi.yaml');

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

function readOpenApiLines(path: string = OPENAPI_PATH): string[] {
  return readFileSync(path, 'utf8').split('\n');
}

function getOpenApiVersionIndex(lines: string[], label: string): number {
  const infoIndex = lines.findIndex((line) => line.trim() === 'info:');
  if (infoIndex === -1) fail(`Could not find \`info:\` block in ${label}`);

  for (let i = infoIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\S/.test(line)) break;
    if (/^ {2}version:\s*/.test(line)) return i;
  }

  fail(`Could not find \`info.version\` in ${label}`);
}

function readOpenApiVersion(): string {
  const label = 'backend/docs/openapi/openapi.yaml';
  const lines = readOpenApiLines(OPENAPI_PATH);
  const versionLine = lines[getOpenApiVersionIndex(lines, label)] ?? '';
  const rawVersion = versionLine.replace(/^ {2}version:\s*/, '').trim();
  return normalizeVersion(rawVersion, `${label} info.version`);
}

function readGeneratedOpenApiVersion(): string {
  const label = 'backend/docs/generated/openapi.yaml';
  const lines = readOpenApiLines(OPENAPI_GENERATED_PATH);
  const versionLine = lines[getOpenApiVersionIndex(lines, label)] ?? '';
  const rawVersion = versionLine.replace(/^ {2}version:\s*/, '').trim();
  return normalizeVersion(rawVersion, `${label} info.version`);
}

function writeOpenApiVersion(version: string): string {
  const lines = readOpenApiLines();
  const versionIndex = getOpenApiVersionIndex(lines, 'backend/docs/openapi/openapi.yaml');
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
  const previousOpenApiVersion = writeOpenApiVersion(version);
  console.log(`backend/package.json: ${previousBackendVersion} -> ${version}`);
  console.log(`backend/docs/openapi/openapi.yaml: ${previousOpenApiVersion} -> ${version}`);

  const previousFrontendVersion = writePackageVersion(
    FRONTEND_PACKAGE_JSON_PATH,
    'frontend/package.json',
    version,
  );
  console.log(`frontend/package.json: ${previousFrontendVersion} -> ${version}`);

  console.log(`Next: commit + jj tag v${version} && jj git push --remote origin`);
}

function runCheck(expectedInput: unknown | undefined): void {
  const expected =
    expectedInput == null || String(expectedInput).trim() === ''
      ? undefined
      : normalizeVersion(expectedInput, 'expected version');

  const backendVersion = readPackageVersion(BACKEND_PACKAGE_JSON_PATH, 'backend/package.json');
  const frontendVersion = readPackageVersion(FRONTEND_PACKAGE_JSON_PATH, 'frontend/package.json');
  const openApiVersion = readOpenApiVersion();
  const generatedOpenApiVersion = readGeneratedOpenApiVersion();

  if (openApiVersion !== backendVersion) {
    fail(
      `backend/docs/openapi/openapi.yaml info.version (${openApiVersion}) does not match backend/package.json (${backendVersion})`,
    );
  }

  if (generatedOpenApiVersion !== backendVersion) {
    fail(
      `backend/docs/generated/openapi.yaml info.version (${generatedOpenApiVersion}) does not match backend/package.json (${backendVersion}) -- run generate:all`,
    );
  }

  if (expected) {
    if (backendVersion !== expected) {
      fail(`backend/package.json version (${backendVersion}) does not match expected version (${expected})`);
    }
    if (frontendVersion !== expected) {
      fail(`frontend/package.json version (${frontendVersion}) does not match expected version (${expected})`);
    }
  }

  if (backendVersion !== frontendVersion) {
    fail(
      `backend version (${backendVersion}) does not match frontend version (${frontendVersion})`,
    );
  }

  console.log(`Version check OK: ${backendVersion}`);
}

function printUsage(): void {
  console.log('Usage: bun run scripts/releaseVersion.ts <set|check> [version]');
  console.log('  set <version>    Update all version targets (backend, frontend, OpenAPI)');
  console.log('  check [version]  Validate all versions match');
}

function main(): void {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === 'set') {
    const version = rawArgs[1];
    if (!version) fail('Missing version. Usage: bun run scripts/releaseVersion.ts set <version>');
    runSet(version);
    return;
  }

  if (command === 'check') {
    runCheck(rawArgs[1]);
    return;
  }

  fail(`Unknown command: ${command}`);
}

main();
