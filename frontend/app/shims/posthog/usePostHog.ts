import { posthog, isAnalyticsEnabled } from '~/utils/posthogClient';

/**
 * Nonproduction replacement for the module's auto-import, registered only when `@posthog/nuxt` is absent.
 * Return the shared proxy only when analytics starts; otherwise return undefined for optional captures.
 * Production uses the plugin-provided instance.
 */
export function usePostHog(): typeof posthog | undefined {
  return isAnalyticsEnabled() ? posthog : undefined;
}
