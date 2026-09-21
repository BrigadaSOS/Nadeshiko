import { spawn } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, watch, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';

const requireFromFrontend = createRequire(import.meta.url);
function linkedPackage(name, entrypoint) {
  const nodeModulesDirectory = requireFromFrontend.resolve.paths(name)?.find((directory) =>
    existsSync(join(directory, name)),
  );
  if (!nodeModulesDirectory) return;
  const packageLink = join(nodeModulesDirectory, name);
  const packageDirectory = realpathSync(packageLink);
  const relativePackageDirectory = relative(nodeModulesDirectory, packageDirectory);
  if (
    !lstatSync(packageLink).isSymbolicLink() ||
    (relativePackageDirectory !== '..' && !relativePackageDirectory.startsWith(`..${sep}`))
  ) return;
  return { name, packageDirectory, entrypoint: join(packageDirectory, entrypoint) };
}

const linkedPackages = [
  linkedPackage('@shirabe-org/api', 'dist/index.js'),
  linkedPackage('@shirabe-org/card', 'dist/word-card/index.js'),
].filter(Boolean);

for (const { name, entrypoint } of linkedPackages) {
  if (!existsSync(entrypoint)) {
    process.stderr.write(`[dev] Waiting for the linked ${name} build...\n`);
    while (!existsSync(entrypoint)) await new Promise((done) => setTimeout(done, 100));
  }
}

let child;
const markerWatchers = [];
let restartTimer;
let startTimer;
let restarting = false;
let stopping = false;
let quickExits = 0;

function start() {
  const startedAt = Date.now();
  child = spawn('nuxt', ['dev'], { stdio: ['inherit', 'inherit', 'inherit'] });
  child.on('exit', (code, signal) => {
    if (!stopping && (restarting || linkedPackages.length > 0)) {
      restarting = false;
      quickExits = Date.now() - startedAt < 10000 ? quickExits + 1 : 0;
      if (quickExits <= 5) {
        startTimer = setTimeout(start, 750);
        return;
      }
    }
    for (const watcher of markerWatchers) watcher.close();
    clearTimeout(restartTimer);
    clearTimeout(startTimer);
    process.exit(signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : (code ?? 1));
  });
}

start();

for (const { packageDirectory } of linkedPackages) {
  const marker = join(packageDirectory, 'dist-ready');
  if (!existsSync(marker)) writeFileSync(marker, '');
  markerWatchers.push(watch(marker, () => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (child.exitCode !== null || restarting || stopping) return;
      restarting = true;
      child.kill('SIGTERM');
    }, 150);
  }));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    for (const watcher of markerWatchers) watcher.close();
    clearTimeout(restartTimer);
    clearTimeout(startTimer);
    if (child.exitCode === null) child.kill(signal);
    else process.exit(0);
  });
}
