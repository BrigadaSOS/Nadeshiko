import { createI18n } from 'vue-i18n';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import ja from '../i18n/locales/ja.json';
import id from '../i18n/locales/id.json';
import ptBR from '../i18n/locales/pt-BR.json';
import zhCN from '../i18n/locales/zh-CN.json';
import zhHant from '../i18n/locales/zh-Hant.json';
import formats from '../i18n/i18n.config';

export const mediaMetaI18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en, es, ja, id, 'pt-BR': ptBR, zh: zhCN, 'zh-hant': zhHant },
  numberFormats: formats.numberFormats,
}).global;
export const formatMediaMetaNumber = (value: number) => mediaMetaI18n.n(value, 'decimal');

const episodeHits = [
  { episode: 1, hitCount: 1200 },
  { episode: 3, hitCount: 34 },
];

type Case = {
  label: string;
  stats?: { matchCount: number; episodeHits?: typeof episodeHits };
  episode?: string;
  bannerUrl?: string | null;
  locale?: 'en' | 'es';
  description: string;
};

export const mediaMetaCases: Case[] = [
  { label: 'missing stats', description: '0 Japanese sentences from Bocchi with English translations.' },
  {
    label: 'match count without episode hits',
    stats: { matchCount: 12345 },
    description: '12,345 Japanese sentences from Bocchi with English translations.',
  },
  {
    label: 'all episodes and banner over portrait cover',
    stats: { matchCount: 1234, episodeHits },
    bannerUrl: 'https://images.test/banner.webp',
    description: '1,234 Japanese sentences from Bocchi across 2 episodes with English translations.',
  },
  {
    label: 'selected episode',
    stats: { matchCount: 1234, episodeHits },
    episode: '3',
    description: '34 Japanese sentences from Bocchi episode 3 with English translations.',
  },
  {
    label: 'selected episode absent from nonempty hits',
    stats: { matchCount: 1234, episodeHits },
    episode: '9',
    description: '0 Japanese sentences from Bocchi episode 9 with English translations.',
  },
  {
    label: 'selected episode with empty hits',
    stats: { matchCount: 1234, episodeHits: [] },
    episode: '3',
    bannerUrl: '',
    description: '0 Japanese sentences from Bocchi with English translations.',
  },
  {
    label: 'selected episode with unavailable hits',
    stats: { matchCount: 1234 },
    episode: '3',
    bannerUrl: null,
    description: '1,234 Japanese sentences from Bocchi with English translations.',
  },
  {
    label: 'duplicate episodes use the first hit even when zero; all entries count as episodes',
    stats: {
      matchCount: 1234,
      episodeHits: [
        { episode: 3, hitCount: 0 },
        { episode: 3, hitCount: 34 },
      ],
    },
    episode: '3',
    description: '0 Japanese sentences from Bocchi episode 3 with English translations.',
  },
  {
    label: 'episode count includes duplicate and zero-hit entries',
    stats: {
      matchCount: 1234,
      episodeHits: [
        { episode: 3, hitCount: 0 },
        { episode: 3, hitCount: 34 },
      ],
    },
    description: '1,234 Japanese sentences from Bocchi across 2 episodes with English translations.',
  },
  {
    label: 'zero episode retains truthy-filter behavior',
    stats: { matchCount: 1234, episodeHits },
    episode: '0',
    description: '1,234 Japanese sentences from Bocchi across 2 episodes with English translations.',
  },
  {
    label: 'invalid episode is ignored',
    stats: { matchCount: 1234, episodeHits },
    episode: 'banana',
    description: '1,234 Japanese sentences from Bocchi across 2 episodes with English translations.',
  },
  {
    label: 'localized title, description and number formatting',
    stats: { matchCount: 12345, episodeHits },
    locale: 'es',
    description:
      'Frases en japonés de «Bocchi»: 12.345, repartidas en 2 episodios. Consulta sus traducciones al español.',
  },
];

// Complete expected head payload, independent of the production metadata builders.
export function expectedMediaMeta(description: string, bannerUrl?: string | null, locale = 'en') {
  const image = bannerUrl || 'https://nadeshiko.test/logo-og-5bc76788.png';
  return {
    title:
      locale === 'es'
        ? 'Bocchi: subtítulos japoneses y frases de ejemplo'
        : 'Bocchi: Japanese subtitles and example sentences',
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: 'Bocchi | Nadeshiko' },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: image },
      { name: 'twitter:image', content: image },
      ...(bannerUrl
        ? []
        : [
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
          ]),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Bocchi | Nadeshiko' },
      { name: 'twitter:description', content: description },
    ],
  };
}

export const expectedFallbackHead = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bocchi: Japanese subtitles and example sentences | Nadeshiko</title>
<meta name="description" content="1,234 Japanese sentences from Bocchi with English translations.">
<meta property="og:title" content="Bocchi | Nadeshiko">
<meta property="og:description" content="1,234 Japanese sentences from Bocchi with English translations.">
<meta property="og:type" content="website">
<meta property="og:image" content="https://nadeshiko.test/logo-og-5bc76788.png">
<meta name="twitter:image" content="https://nadeshiko.test/logo-og-5bc76788.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Bocchi | Nadeshiko">
<meta name="twitter:description" content="1,234 Japanese sentences from Bocchi with English translations.">`;
