import { expect } from 'bun:test';

function equalsWithExpect(actual: unknown, expected: unknown): boolean {
  try {
    expect(actual).toEqual(expected);
    return true;
  } catch {
    return false;
  }
}

function hasExactArrayContents(received: readonly unknown[], expected: readonly unknown[]): boolean {
  if (received.length !== expected.length) return false;

  const used = new Array(received.length).fill(false);
  for (const expectedItem of expected) {
    let matched = false;
    for (let i = 0; i < received.length; i += 1) {
      if (!used[i] && equalsWithExpect(received[i], expectedItem)) {
        used[i] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }

  return true;
}

expect.extend({
  toEqualUnordered(received: unknown, expected: readonly unknown[]) {
    if (!Array.isArray(received)) {
      return {
        pass: false,
        message: () => `Expected an array but received ${typeof received}`,
      };
    }
    const pass = hasExactArrayContents(received, expected);
    return {
      pass,
      message: () =>
        pass
          ? `Expected array not to contain exactly the given items (any order)`
          : `Expected array to contain exactly ${expected.length} items matching the given matchers (any order), but received ${received.length} items`,
    };
  },
});
