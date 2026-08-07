import { describe, expect, it } from 'vitest';
import { EXCEPTION_DEDUPE_WINDOW_MS, createExceptionDeduper, exceptionSignature } from '~/utils/exceptionDedupe';

describe('exceptionSignature', () => {
  it('keys on the first exception type and value', () => {
    const signature = exceptionSignature({
      $exception_list: [{ type: 'TypeError', value: 'Failed to fetch dynamically imported module' }],
    });

    expect(signature).toBe('TypeError|Failed to fetch dynamically imported module');
  });

  it('matches the same throw whether it was captured handled or unhandled', () => {
    // The two capture paths differ on `$exception_handled`, so it must not be part
    // of the key or the duplicate would never be recognised.
    const list = [{ type: 'TypeError', value: 'A is null' }];

    expect(exceptionSignature({ $exception_list: list, $exception_handled: true })).toBe(
      exceptionSignature({ $exception_list: list, $exception_handled: false }),
    );
  });

  it('distinguishes different messages of the same type', () => {
    expect(exceptionSignature({ $exception_list: [{ type: 'TypeError', value: 'a' }] })).not.toBe(
      exceptionSignature({ $exception_list: [{ type: 'TypeError', value: 'b' }] }),
    );
  });

  it('falls back to the flattened values', () => {
    expect(exceptionSignature({ $exception_values: ['boom'] })).toBe('boom');
  });

  it.each([undefined, {}, { $exception_list: [] }, { $exception_list: [{}] }])(
    'returns null for unidentifiable payload %j',
    (properties) => {
      expect(exceptionSignature(properties)).toBeNull();
    },
  );
});

describe('createExceptionDeduper', () => {
  it('lets the first occurrence through and drops the immediate duplicate', () => {
    const isDuplicate = createExceptionDeduper();

    expect(isDuplicate('TypeError|boom', 1_000)).toBe(false);
    expect(isDuplicate('TypeError|boom', 1_030)).toBe(true);
  });

  it('keeps unrelated errors independent', () => {
    const isDuplicate = createExceptionDeduper();

    expect(isDuplicate('TypeError|a', 1_000)).toBe(false);
    expect(isDuplicate('TypeError|b', 1_010)).toBe(false);
  });

  it('lets a genuine recurrence through once the window has passed', () => {
    const isDuplicate = createExceptionDeduper();

    expect(isDuplicate('TypeError|boom', 1_000)).toBe(false);
    expect(isDuplicate('TypeError|boom', 1_000 + EXCEPTION_DEDUPE_WINDOW_MS)).toBe(false);
  });

  it('does not grow without bound as distinct errors age out', () => {
    const isDuplicate = createExceptionDeduper(100);

    for (let i = 0; i < 500; i++) {
      isDuplicate(`TypeError|${i}`, i * 10);
    }

    // Only entries inside the trailing window survive pruning, so a long session
    // cannot accumulate one map entry per error it ever saw.
    expect(isDuplicate('TypeError|0', 5_000)).toBe(false);
  });
});
