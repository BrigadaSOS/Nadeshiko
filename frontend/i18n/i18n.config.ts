import en from './locales/en.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };

// Shared shapes: the Intl options are locale-independent, only the resolved
// output differs. Keeping them in one place stops the three locales drifting.
const shortDate = { year: 'numeric', month: 'short', day: 'numeric' } as const;
const longDate = { year: 'numeric', month: 'long', day: 'numeric' } as const;
const dateTime = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as const;

const datetimeFormats = {
  short: shortDate,
  long: longDate,
  dateTime,
};

const decimal = { style: 'decimal' } as const;
const percent = { style: 'percent', maximumFractionDigits: 1 } as const;

const numberFormats = {
  decimal,
  percent,
};

export default {
  legacy: false,
  globalInjection: true,
  messages: {
    en,
    es,
    ja,
  },
  datetimeFormats: {
    en: datetimeFormats,
    es: datetimeFormats,
    ja: datetimeFormats,
  },
  numberFormats: {
    en: numberFormats,
    es: numberFormats,
    ja: numberFormats,
  },
};
