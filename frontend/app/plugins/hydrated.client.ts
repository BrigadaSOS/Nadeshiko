/**
 * Expose a document-level hydration marker so e2e interactions wait for mounted handlers rather than racing
 * visible SSR cards or guessing with sleeps.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    document.documentElement.dataset.hydrated = 'true';
  });
});
