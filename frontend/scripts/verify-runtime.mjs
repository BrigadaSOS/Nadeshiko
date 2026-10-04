import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyWorkerProcesses(processes, expectedWorkers) {
  if (!Number.isInteger(expectedWorkers) || expectedWorkers < 1) {
    throw new Error('NITRO_CLUSTER_WORKERS must be a positive integer');
  }
  const servers = processes.filter(
    ({ argv }) => basename(argv[0] ?? '') === 'node' && argv.some((arg) => arg.endsWith('.output/server/index.mjs')),
  );
  const ids = new Set(servers.map(({ pid }) => pid));
  const primaries = servers.filter(({ ppid }) => !ids.has(ppid));
  const workers = servers.filter(({ ppid }) => primaries.some(({ pid }) => pid === ppid));
  if (primaries.length !== 1 || workers.length !== expectedWorkers || servers.length !== expectedWorkers + 1) {
    throw new Error(
      `Expected one Nitro primary and ${expectedWorkers} workers; found ${primaries.length} primary and ${workers.length} workers`,
    );
  }
  return workers.length;
}

export async function verifyRuntime() {
  const processes = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      processes.push({ pid: Number(pid), ppid, argv });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
  }
  const workers = verifyWorkerProcesses(processes, Number(process.env.NITRO_CLUSTER_WORKERS));
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/up`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Frontend health returned HTTP ${response.status}`);
  console.log(`Frontend runtime verified: ${workers} serving workers and healthy /up`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyRuntime();
