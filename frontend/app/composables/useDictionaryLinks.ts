export type DictionaryId = 'jisho' | 'jpdb' | 'shirabe' | 'weblio' | 'takoboto';

export type DictionaryPreset = {
  id: DictionaryId;
  label: string;
  buildUrl: (word: string, reading: string) => string;
  defaultEnabled: boolean;
};

export const DICTIONARY_PRESETS: DictionaryPreset[] = [
  {
    id: 'jisho',
    label: 'Jisho',
    buildUrl: (word) => `https://jisho.org/search/${encodeURIComponent(word)}`,
    defaultEnabled: true,
  },
  {
    id: 'jpdb',
    label: 'JPDB',
    buildUrl: (word) => `https://jpdb.io/search?q=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'shirabe',
    label: 'Shirabe Jisho',
    buildUrl: (word) => `shirabelookup://search?w=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'weblio',
    label: 'Weblio',
    buildUrl: (word) => `https://www.weblio.jp/content/${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'takoboto',
    label: 'Takoboto',
    buildUrl: (word) => `https://takoboto.jp/?q=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
];

const VALID_IDS = new Set<string>(DICTIONARY_PRESETS.map((d) => d.id));
const COOKIE_NAME = 'nd_dict_links';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const decodeEnabled = (raw: string | null | undefined): DictionaryId[] => {
  if (raw === null || raw === undefined) {
    return DICTIONARY_PRESETS.filter((d) => d.defaultEnabled).map((d) => d.id);
  }
  if (raw === '') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DictionaryId => VALID_IDS.has(s));
};

export function useDictionaryLinks() {
  const cookie = useCookie<string | null>(COOKIE_NAME, {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    encode: String,
    decode: String,
  });

  const enabledDictionaries = useState<DictionaryId[]>('dictionary-links-enabled', () => decodeEnabled(cookie.value));

  if (import.meta.server) {
    enabledDictionaries.value = decodeEnabled(cookie.value);
  }

  const setDictionaryEnabled = (id: DictionaryId, enabled: boolean) => {
    const next = new Set(enabledDictionaries.value);
    if (enabled) next.add(id);
    else next.delete(id);
    const ordered = DICTIONARY_PRESETS.filter((d) => next.has(d.id)).map((d) => d.id);
    enabledDictionaries.value = ordered;
    cookie.value = ordered.join(',');
  };

  const isDictionaryEnabled = (id: DictionaryId) => enabledDictionaries.value.includes(id);

  return {
    presets: DICTIONARY_PRESETS,
    enabledDictionaries,
    isDictionaryEnabled,
    setDictionaryEnabled,
  };
}
