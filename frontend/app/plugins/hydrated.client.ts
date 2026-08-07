/**
 * Marks the document once Vue has finished hydrating, as `<html data-hydrated>`.
 *
 * Every interactive handler on a search page attaches on mount — the segment
 * keyboard listener, the image-zoom click, the infinite-scroll observer. The
 * cards themselves are server-rendered, so they are visible and clickable well
 * before any of that exists, and an interaction in that window is swallowed
 * with no error: the DOM looks ready because it is, just not yet wired.
 *
 * That gap is what made four e2e tests flaky rather than failing — they raced
 * hydration and won often enough to look fine. Tests wait for this attribute
 * instead of guessing with a sleep, which is both faster and actually correct.
 *
 * Deliberately an attribute on <html>: it survives page-level re-renders, costs
 * nothing, and is inert to everything except a selector that looks for it.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    document.documentElement.dataset.hydrated = 'true';
  });
});
