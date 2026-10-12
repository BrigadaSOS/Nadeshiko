// Stub #app without requiring generated .nuxt artifacts or the whole runtime. useNuxtApp delegates to the test
// global so missing stubs fail loudly rather than return an empty object.
export function useNuxtApp(): ReturnType<typeof globalThis.useNuxtApp> {
  return (globalThis as { useNuxtApp?: () => unknown }).useNuxtApp!() as never;
}

// Expose the plugin factory itself as the test subject.
export function defineNuxtPlugin<T>(plugin: T): T {
  return plugin;
}

export interface NuxtError<DataT = unknown> extends Error {
  statusCode: number;
  statusMessage?: string;
  fatal?: boolean;
  unhandled?: boolean;
  data?: DataT;
}
