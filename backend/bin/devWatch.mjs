import { existsSync, lstatSync, realpathSync, watch, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const apiLink = resolve('node_modules/@shirabe-org/api');
const apiDir = realpathSync(apiLink);
const relativeToNodeModules = relative(resolve('node_modules'), apiDir);
const linked =
  lstatSync(apiLink).isSymbolicLink() &&
  (relativeToNodeModules === '..' || relativeToNodeModules.startsWith(`..${sep}`));

if (linked) {
  const entrypoints = [join(apiDir, 'dist/index.js'), join(apiDir, 'dist/server.js')];
  if (entrypoints.some((path) => !existsSync(path))) {
    process.stderr.write('[dev] Waiting for the linked Shirabe API build...\n');
    while (entrypoints.some((path) => !existsSync(path))) {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}

const child = spawn('tsx', ['watch', '--exclude', `${apiDir}/dist/**`, 'bin/dev.ts'], {
  stdio: ['pipe', 'inherit', 'inherit'],
});

let markerWatcher;
let restartTimer;
if (linked) {
  const marker = join(apiDir, 'dist-ready');
  if (!existsSync(marker)) writeFileSync(marker, '');

  markerWatcher = watch(marker, () => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (child.stdin.writable) child.stdin.write('\n');
    }, 150);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    markerWatcher?.close();
    clearTimeout(restartTimer);
    child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  markerWatcher?.close();
  clearTimeout(restartTimer);
  process.exit(signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : (code ?? 1));
});
