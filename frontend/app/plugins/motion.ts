/**
 * Stamps `<html data-motion>` from the reader's cookie.
 *
 * A plugin rather than a component so it runs during SSR: the motion tiers in
 * `assets/css/tailwind.css` key off this attribute, and an attribute that only
 * appeared after hydration would let the first animation of the page through
 * before the setting applied.
 *
 * `system` is written as-is rather than resolved. The server cannot read an OS
 * setting, and the CSS answers it with a media query anyway -- resolving it
 * here would make the markup differ per reader for no gain.
 */
export default defineNuxtPlugin(() => {
  const { preference } = useMotionPreference();

  useHead({
    htmlAttrs: {
      'data-motion': () => preference.value,
    },
  });
});
