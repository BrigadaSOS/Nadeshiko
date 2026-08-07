import posthog from 'posthog-js';

/**
 * Stands in for the `usePostHog()` that `@posthog/nuxt` auto-imports.
 *
 * The module ships in production only, so outside production the composable it
 * provides does not exist and the ~30 call sites that reach for it would throw
 * at setup -- taking the whole page down rather than merely losing an event.
 * `nuxt.config.ts` adds this directory to `imports.dirs` exactly when the module
 * is absent, so the two never collide and production always gets the real one.
 *
 * Returns `undefined` rather than a no-op double: every call site already writes
 * `posthog?.capture(...)`, which is the same shape the real composable needs
 * (it returns `$posthog?.()`, itself optional).
 */
export function usePostHog(): typeof posthog | undefined {
  return posthog.__loaded ? posthog : undefined;
}
