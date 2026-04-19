import en from './locales/en.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };

export default {
  legacy: false,
  globalInjection: true,
  messages: {
    en,
    es,
    ja,
  },
};
