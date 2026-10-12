<script setup lang="ts">
import { DEFAULT_OG_IMAGE_PATH, buildOgImageTags } from '~/utils/metaTags';

const { t } = useI18n();
const { origin } = useRequestURL();
const ogImage = `${origin}${DEFAULT_OG_IMAGE_PATH}`;

// Keep locale attributes/meta here; canonical and hreflang links belong together in
// plugins/canonical.ts to avoid over-encoded search URLs from the router path.
const i18nHead = useLocaleHead();

useHead(() => ({
  htmlAttrs: i18nHead.value.htmlAttrs ?? {},
  meta: [
    ...(i18nHead.value.meta ?? []),
    { name: 'description', content: t('appMeta.defaultDescription') },
    { property: 'og:title', content: t('appMeta.defaultTitle') },
    { property: 'og:description', content: t('appMeta.defaultDescription') },
    // Omit fallback dimensions: Unhead dedupes tags individually, so a page overriding
    // only the image URL would otherwise inherit dimensions for the wrong image.
    ...buildOgImageTags(ogImage),
    { name: 'twitter:title', content: t('appMeta.defaultTitle') },
    { name: 'twitter:description', content: t('appMeta.defaultDescription') },
  ],
  // The SEO title template appends the brand; social titles do not use that template.
  title: t('appMeta.defaultPageTitle'),
}));

// Localize the description here; nuxt.config cannot resolve per-locale copy.
// Omit @id to merge into the module's #website node rather than create a second WebSite.
useSchemaOrg([defineWebSite({ description: t('appMeta.defaultDescription') })]);
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
