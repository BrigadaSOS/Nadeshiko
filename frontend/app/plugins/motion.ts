/**
 * Set the motion attribute during SSR so initial animations honor the cookie. Leave `system` unresolved; CSS
 * media queries read the OS preference.
 */
export default defineNuxtPlugin(() => {
  const { preference } = useMotionPreference();

  useHead({
    htmlAttrs: {
      'data-motion': () => preference.value,
    },
  });
});
