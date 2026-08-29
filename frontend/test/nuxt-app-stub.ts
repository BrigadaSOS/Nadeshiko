/**
 * Stands in for Nuxt's `#app` virtual module under vitest.
 *
 * `#app` is generated into `.nuxt/` by `nuxt prepare`, and pointing the alias
 * there instead would make the test suite depend on a build artifact -- a fresh
 * clone, and CI, would fail to collect any file that transitively imports a
 * store. It also drags in the whole Nuxt runtime for the sake of two symbols.
 *
 * Only what app code actually imports from `#app` by name lives here; everything
 * else Nuxt provides is auto-imported and reaches a test as a global it stubs
 * itself.
 *
 * `useNuxtApp` is deliberately NOT implemented: it returns whatever the test has
 * put on `globalThis`, so a file that forgot to stub it fails loudly on the
 * missing global rather than quietly receiving an empty object and rendering
 * `undefined` into an assertion that still passes.
 */
export function useNuxtApp(): ReturnType<typeof globalThis.useNuxtApp> {
  return (globalThis as { useNuxtApp?: () => unknown }).useNuxtApp!() as never;
}

/** Nuxt calls the plugin factory itself; under test the factory IS the subject. */
export function defineNuxtPlugin<T>(plugin: T): T {
  return plugin;
}

/** The error shape Nuxt attaches to `showError`/`createError`. */
export interface NuxtError<DataT = unknown> extends Error {
  statusCode: number;
  statusMessage?: string;
  fatal?: boolean;
  unhandled?: boolean;
  data?: DataT;
}
