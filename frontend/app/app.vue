<script setup>
const { t } = useI18n();
const { origin } = useRequestURL();
const ogImage = `${origin}/logo-og-5bc76788.png`;

// `useLocaleHead()` provides <html lang>, hreflang alternates, and og:locale meta tags
// so search engines can connect /en/foo, /es/foo, /ja/foo as language variants.
// We strip its canonical entry because plugins/canonical.ts emits a per-page canonical.
const i18nHead = useLocaleHead();

useHead(() => ({
  htmlAttrs: i18nHead.value.htmlAttrs ?? {},
  link: (i18nHead.value.link ?? []).filter((l) => l.rel !== 'canonical'),
  meta: [
    ...(i18nHead.value.meta ?? []),
    { name: 'description', content: t('appMeta.defaultDescription') },
    { property: 'og:title', content: t('appMeta.defaultTitle') },
    { property: 'og:description', content: t('appMeta.defaultDescription') },
    { property: 'og:image', content: ogImage },
    { name: 'twitter:title', content: t('appMeta.defaultTitle') },
    { name: 'twitter:description', content: t('appMeta.defaultDescription') },
    { name: 'twitter:image', content: ogImage },
  ],
  title: t('appMeta.defaultTitle'),
}));
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
