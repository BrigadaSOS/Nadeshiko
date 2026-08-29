import { describe, expect, test } from 'vitest';
import { createAdmissionGate } from './ssrAdmission';

describe('createAdmissionGate', () => {
  test('hands out exactly `max` slots and refuses the next', () => {
    const gate = createAdmissionGate(2);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.inFlight()).toBe(2);
  });

  test('a released slot can be acquired again', () => {
    const gate = createAdmissionGate(1);
    const release = gate.tryAcquire();
    expect(gate.tryAcquire()).toBeNull();
    release?.();
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
  });

  test('releasing twice gives back one slot, not two', () => {
    // `finish` and `close` both fire on a clean response, so the middleware
    // calls release twice for every request that completes normally.
    const gate = createAdmissionGate(1);
    const release = gate.tryAcquire();
    release?.();
    release?.();
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });

  test('a refusal does not consume a slot', () => {
    const gate = createAdmissionGate(1);
    const release = gate.tryAcquire();
    gate.tryAcquire();
    gate.tryAcquire();
    release?.();
    expect(gate.inFlight()).toBe(0);
  });

  test.each([0, -1, 1.5, Number.NaN])('rejects a capacity of %s', (max) => {
    expect(() => createAdmissionGate(max)).toThrow(RangeError);
  });
});
