import 'vitest';

declare module 'vitest' {
  interface Matchers<T = any> {
    toEqualUnordered(expected: readonly unknown[]): T;
  }
}
