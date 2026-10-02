import { describe, expect, it } from 'vitest';
import { verifyWorkerProcesses } from '../../scripts/verify-runtime.mjs';

const server = (pid: number, ppid: number) => ({
  pid,
  ppid,
  argv: ['/usr/local/bin/node', '--import', './instrumentation.mjs', '.output/server/index.mjs'],
});

describe('production runtime verification', () => {
  it('rejects a node-server image even when the runtime environment claims two workers', () => {
    expect(() => verifyWorkerProcesses([server(7, 1)], 2)).toThrow('found 1 primary and 0 workers');
  });
  it('accepts the actual cluster and ignores init and health-check processes', () => {
    expect(
      verifyWorkerProcesses(
        [
          server(7, 1),
          server(20, 7),
          server(21, 7),
          { pid: 1, ppid: 0, argv: ['/sbin/docker-init', 'node', '.output/server/index.mjs'] },
          { pid: 30, ppid: 1, argv: ['node', '-e', 'fetch("/up")'] },
        ],
        2,
      ),
    ).toBe(2);
  });
  it('rejects a cluster that has lost a worker', () => {
    expect(() => verifyWorkerProcesses([server(7, 1), server(20, 7)], 2)).toThrow('found 1 primary and 1 workers');
  });
  it('rejects invalid worker settings and multiple server primaries', () => {
    expect(() => verifyWorkerProcesses([server(7, 1)], Number.NaN)).toThrow('positive integer');
    expect(() => verifyWorkerProcesses([server(7, 1), server(20, 1)], 2)).toThrow('found 2 primary');
  });
});
