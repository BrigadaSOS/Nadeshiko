import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_GENERATED_FILES,
  clearGeneratedReady,
  isGeneratedReady,
  markGeneratedReady,
  waitForGenerated,
} from '../../bin/lib/generatedReady';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-ready-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('generatedReady', () => {
  it('is not ready when the directory is empty', () => {
    expect(isGeneratedReady(dir)).toBe(false);
  });

  it('is ready when the marker exists', () => {
    markGeneratedReady(dir);
    expect(isGeneratedReady(dir)).toBe(true);
  });

  it('is ready when the committed generated files exist, even without a marker', () => {
    for (const file of REQUIRED_GENERATED_FILES) {
      fs.writeFileSync(path.join(dir, file), '');
    }

    expect(isGeneratedReady(dir)).toBe(true);
  });

  it('clearGeneratedReady removes the marker without deleting the directory', () => {
    markGeneratedReady(dir);
    fs.writeFileSync(path.join(dir, 'models.ts'), 'export {}\n');

    clearGeneratedReady(dir);

    expect(isGeneratedReady(dir)).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'models.ts'))).toBe(true);
  });

  it('waitForGenerated resolves immediately when the marker is already there', async () => {
    markGeneratedReady(dir);
    const onWaiting = vi.fn();

    await waitForGenerated(dir, { onWaiting, intervalMs: 10 });

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('waitForGenerated pauses until the marker appears', async () => {
    const onWaiting = vi.fn();
    const waiting = waitForGenerated(dir, { onWaiting, intervalMs: 10 });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(isGeneratedReady(dir)).toBe(false);

    markGeneratedReady(dir);
    await waiting;

    expect(isGeneratedReady(dir)).toBe(true);
  });

  it('waitForGenerated aborts instead of hanging forever', async () => {
    const controller = new AbortController();
    const waiting = waitForGenerated(dir, { intervalMs: 10, signal: controller.signal });

    controller.abort();

    await expect(waiting).rejects.toThrow(/Aborted while waiting for generated/);
  });
});
