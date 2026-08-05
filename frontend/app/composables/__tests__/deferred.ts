/**
 * A promise plus the handle to settle it later, so tests can interleave two
 * in-flight requests and assert what happens between them.
 */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
