import { afterEach, expect, it } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { registerTelemetryShutdown, shutdownTelemetry } from '@config/telemetry';

afterEach(() => {
  registerTelemetryShutdown(async () => {});
});

it('waits for asynchronous telemetry cleanup before the caller can exit', async () => {
  await expect(shutdownTelemetry()).resolves.toBeUndefined();
  const events: string[] = [];
  registerTelemetryShutdown(async () => {
    await setImmediate();
    events.push('telemetry exported');
  });

  await shutdownTelemetry();
  events.push('safe to exit');
  expect(events).toEqual(['telemetry exported', 'safe to exit']);
});

it('reports failed telemetry cleanup to the application shutdown owner', async () => {
  registerTelemetryShutdown(async () => {
    throw new Error('telemetry export failed');
  });

  await expect(shutdownTelemetry()).rejects.toThrow('telemetry export failed');
});
