<script setup lang="ts">
const { t } = useI18n();
const { origin } = useRequestURL();
const ogImage = `${origin}/logo-og-5bc76788.png`;

// `useLocaleHead()` provides <html lang> and og:locale meta tags so search engines
// can connect /en/foo, /es/foo, /ja/foo as language variants.
//
// We keep NONE of its links. The canonical was already ours; the hreflang
// alternates moved to plugins/canonical.ts for the reason spelled out there, and
// they have to move together -- the module builds every href from the router's
// current path, which on a search page is percent-encoded one layer deeper than
// the URL that was requested, so each render advertised four URLs that had never
// existed. Leaving the alternates here would have kept three quarters of that
// loop alive after the canonical was fixed.
const i18nHead = useLocaleHead();

useHead(() => ({
  htmlAttrs: i18nHead.value.htmlAttrs ?? {},
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
