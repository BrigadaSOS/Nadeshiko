declare module 'bun:test' {
  interface Matchers<T> {
    toEqualUnordered(expected: readonly unknown[]): void;
  }
}
