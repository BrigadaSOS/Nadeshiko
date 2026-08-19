<script setup lang="ts">
import { DEFAULT_OG_IMAGE_PATH, DEFAULT_OG_IMAGE_SIZE, buildOgImageTags } from '~/utils/metaTags';

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
    // The size travels with the image: a page that overrides `og:image` also
    // overrides these two, which is the whole point of keeping them together.
    ...buildOgImageTags(ogImage, DEFAULT_OG_IMAGE_SIZE),
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
 * The publisher behind every page, declared once at the root.
 *
 * Without it the graph had no `Organization` node at all, so the `WebPage` and
 * `Article` nodes the pages below emit had nothing to name as their publisher --
 * and `defineArticle` on the blog quietly wants one. Declaring it here rather
 * than per-page means the id is stable and every page's graph can reference it.
 *
 * `sameAs` is only for profiles that are unambiguously ours and unlikely to
 * move; it is how a search engine ties this site to those accounts.
 */
useSchemaOrg([
  defineOrganization({
    name: 'Nadeshiko',
    logo: `${origin}${DEFAULT_OG_IMAGE_PATH}`,
    sameAs: ['https://github.com/BrigadaSOS', 'https://www.patreon.com/BrigadaSOS', 'https://discord.gg/qRak9MprUS'],
  }),
]);
</script>

<template>
  <NuxtLoadingIndicator />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
