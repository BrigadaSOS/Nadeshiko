const shortDate = { year: 'numeric', month: 'short', day: 'numeric' } as const;
const longDate = { year: 'numeric', month: 'long', day: 'numeric' } as const;
const dateTime = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as const;

// Pin SSR content dates to UTC to prevent browser/server timezone hydration mismatches.
// Personal timestamps use the reader's zone and are not server-rendered.
const dateUtc = { ...shortDate, timeZone: 'UTC' } as const;

const datetimeFormats = {
  short: shortDate,
  long: longDate,
  dateTime,
  dateUtc,
};

const decimal = { style: 'decimal' } as const;
const percent = { style: 'percent', maximumFractionDigits: 1 } as const;

const numberFormats = {
  decimal,
  percent,
};

// Declare message files in nuxt.config.ts so only the active locale loads; importing them here bundles all locales.
export default {
  legacy: false,
  globalInjection: true,
  datetimeFormats: {
    en: datetimeFormats,
    es: datetimeFormats,
    ja: datetimeFormats,
    zh: datetimeFormats,
    'zh-hant': datetimeFormats,
    id: datetimeFormats,
    'pt-BR': datetimeFormats,
  },
  numberFormats: {
    en: numberFormats,
    es: numberFormats,
    ja: numberFormats,
    zh: numberFormats,
    'zh-hant': numberFormats,
    id: numberFormats,
    'pt-BR': numberFormats,
  },
};
