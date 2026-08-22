<script setup lang="ts">
import { DEFAULT_OG_IMAGE_PATH, buildOgImageTags } from '~/utils/metaTags';

const { t } = useI18n();
const { origin } = useRequestURL();
const ogImage = `${origin}${DEFAULT_OG_IMAGE_PATH}`;

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
    // Image only, deliberately without its size. The size cannot be stated
    // here: this is the fallback layer, and unhead dedupes `og:image` per tag,
    // not per group -- a page that overrode the image but knew no size (a media
    // banner, whose height varies by title) replaced the URL and left this
    // pair behind, so 1200x630 went on describing a 1200x400 banner. A page
    // that genuinely uses the default card declares the size itself.
    ...buildOgImageTags(ogImage),
    { name: 'twitter:title', content: t('appMeta.defaultTitle') },
    { name: 'twitter:description', content: t('appMeta.defaultDescription') },
  ],
  /**
   * The brandless variant, unlike the social titles above.
   *
   * `@nuxtjs/seo` installs `titleTemplate: '%s %separator %siteName'`, so
   * whatever goes here comes out with ` | Nadeshiko` already appended. This is
   * the fallback for every page that sets no title of its own -- the account,
   * settings and admin screens, seventeen of them -- and with the branded string
   * they all rendered `Nadeshiko: Search Japanese sentences from anime |
   * Nadeshiko`.
   *
   * `og:title` and `twitter:title` keep the branded one: those are set
   * explicitly per page and never see the template.
   */
  title: t('appMeta.defaultPageTitle'),
}));

/**
 * The `WebSite` node's description, in the language of the page carrying it.
 *
 * `site.description` in nuxt.config is a single hardcoded string, so every
 * locale's structured data quoted the English one: `/es/` pages shipped
 * `"inLanguage":"es"` beside an English sentence, on every page of the Spanish
 * site. The config value is now language-neutral -- no locale can be wrong
 * about a description that names no language -- and the real per-locale copy
 * comes from here, where `t()` can see which locale is rendering.
 *
 * No `@id`: leaving it to resolve to the module's own `#website` node is what
 * makes this a merge rather than a second WebSite in the graph. The home page
 * adds `potentialAction` to the same node the same way.
 */
useSchemaOrg([defineWebSite({ description: t('appMeta.defaultDescription') })]);
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
