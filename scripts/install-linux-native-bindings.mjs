#!/usr/bin/env node
/**
 * Installs the Linux native bindings that `npm ci` leaves out of the tree.
 *
 * Packages built with napi (oxc-parser, oxc-transform, rolldown, ...) ship their
 * compiled binary as a set of platform-specific optional dependencies and pick
 * the matching one at runtime. npm records optional packages only for the
 * platform that resolved them (npm/cli#4828), so a lockfile generated on macOS
 * contains no installable entry for any Linux binding and `npm ci` cannot
 * produce one on a Linux image. Dropping the lockfile is not an option either:
 * a full re-resolve fails on an unrelated peer-dependency conflict.
 *
 * This walks the installed tree, finds every optional dependency that matches
 * the current platform but is missing, and fetches those tarballs straight from
 * the registry — deliberately bypassing npm's resolver, which is what fails.
 *
 * Only used when building container images. Local installs on the machine that
 * generated the lockfile already have the right bindings.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const require = createRequire(join(ROOT, 'noop.js'));
// e.g. "linux-x64-gnu" / "linux-arm64-gnu". musl images would need "-musl";
// the images this runs in are all Debian-based.
const PLATFORM_SUFFIXES = [`${process.platform}-${process.arch}-gnu`, `${process.platform}-${process.arch}`];

/** Every package.json under any node_modules directory, depth-first. */
function* installedManifests(dir, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const child = join(dir, entry.name);
    if (entry.name === 'node_modules') {
      yield* installedManifests(child, depth + 1);
      continue;
    }
    const manifest = join(child, 'package.json');
    if (existsSync(manifest)) {
      try {
        yield { dir: child, pkg: JSON.parse(readFileSync(manifest, 'utf8')) };
      } catch {
        // Unparseable manifest: not something we can act on.
      }
    }
    if (entry.name.startsWith('@') || existsSync(join(child, 'node_modules'))) {
      yield* installedManifests(child, depth + 1);
    }
  }
}

const missing = new Map();
for (const { dir, pkg } of installedManifests(join(ROOT, 'node_modules'))) {
  for (const [name, version] of Object.entries(pkg.optionalDependencies ?? {})) {
    if (!PLATFORM_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
    const scopedRequire = createRequire(join(dir, 'noop.js'));
    try {
      scopedRequire.resolve(`${name}/package.json`);
    } catch {
      missing.set(name, version);
    }
  }
}

if (missing.size === 0) {
  console.log('Native bindings: nothing missing.');
  process.exit(0);
}

const staging = mkdtempSync(join(tmpdir(), 'native-bindings-'));
for (const [name, version] of missing) {
  const target = resolve(ROOT, 'node_modules', name);
  console.log(`Native bindings: installing ${name}@${version}`);
  const output = execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', staging], {
    encoding: 'utf8',
  });
  const tarball = join(staging, output.trim().split('\n').pop().trim());
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);
  rmSync(tarball, { force: true });
}
rmSync(staging, { recursive: true, force: true });

// Fail loudly rather than leaving a build to die later with a confusing
// "Cannot find native binding" from deep inside a bundler. Checked on disk
// rather than with require.resolve: several of these packages do not list
// ./package.json in their `exports`, so resolving it throws even when the
// package is installed correctly.
for (const name of missing.keys()) {
  const manifest = resolve(ROOT, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(`Failed to install native binding ${name}: ${manifest} is missing.`);
  }
}
console.log(`Native bindings: installed ${missing.size} package(s).`);
