<script setup>
const { t, locale } = useI18n();
const { origin } = useRequestURL();
const ogImage = `${origin}/logo-og-5bc76788.png`;

useHead({
  htmlAttrs: {
    lang: locale,
  },
  title: () => t('appMeta.defaultTitle'),
  meta: [
    { name: 'description', content: () => t('appMeta.defaultDescription') },
    { property: 'og:title', content: () => t('appMeta.defaultTitle') },
    { property: 'og:description', content: () => t('appMeta.defaultDescription') },
    { property: 'og:image', content: ogImage },
    { name: 'twitter:title', content: () => t('appMeta.defaultTitle') },
    { name: 'twitter:description', content: () => t('appMeta.defaultDescription') },
    { name: 'twitter:image', content: ogImage },
  ],
});
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
