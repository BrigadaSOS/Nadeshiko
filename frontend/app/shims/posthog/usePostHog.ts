import { posthog, isAnalyticsEnabled } from '~/utils/posthogClient';

/**
 * Stands in for the `usePostHog()` that `@posthog/nuxt` auto-imports.
 *
 * The module ships in production only, so outside production the composable it
 * provides does not exist and the ~30 call sites that reach for it would throw
 * at setup -- taking the whole page down rather than merely losing an event.
 * `nuxt.config.ts` adds this directory to `imports.dirs` exactly when the module
 * is absent, so the two never collide and production always gets the real one
 * (which `plugins/posthog.client.ts` now provides, returning the same object
 * this does).
 *
 * Returns `undefined` rather than a no-op double: every call site already writes
 * `posthog?.capture(...)`, which is the same shape the real composable needs
 * (it returns `$posthog?.()`, itself optional).
 *
 * `isAnalyticsEnabled()` is false on every build this file is compiled into --
 * nothing starts the client outside production -- so this always answers
 * `undefined` in practice. It is written as a question rather than a constant
 * because the alternative is a `return undefined` nobody can check against the
 * production path.
 */
export function usePostHog(): typeof posthog | undefined {
  return isAnalyticsEnabled() ? posthog : undefined;
}
