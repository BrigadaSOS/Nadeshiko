// Shared shapes: the Intl options are locale-independent, only the resolved
// output differs. Keeping them in one place stops the three locales drifting.
const shortDate = { year: 'numeric', month: 'short', day: 'numeric' } as const;
const longDate = { year: 'numeric', month: 'long', day: 'numeric' } as const;
const dateTime = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as const;

// Anything rendered during SSR has to name a zone or it renders twice: Node has
// no timezone but UTC, the browser has the reader's, and a stamp near midnight
// resolves to two different days -- a hydration mismatch, and a wrong date on
// screen until the client quietly corrects it. Published and updated dates are
// facts about the content rather than about the reader, so they pin to UTC and
// read the same everywhere. Personal timestamps -- sessions, activity -- keep
// using `short`/`dateTime` and stay in the reader's own zone, where local time
// is the useful answer and nothing is server-rendered.
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

// No `messages` here, deliberately. Importing the three JSONs compiled them into
// one chunk every reader downloaded whole -- 41,974 B brotli of en+es+ja, 10.8% of
// the page's JS -- so the locales are declared as `file:` in nuxt.config.ts and the
// module loads only the active one. What stays is the part that is genuinely shared:
// the Intl formats below, which are locale-independent by construction.
export default {
  legacy: false,
  globalInjection: true,
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
