export type DictionaryId = 'jisho' | 'jpdb' | 'shirabe' | 'weblio' | 'takoboto';

export type DictionaryPreset = {
  id: DictionaryId;
  label: string;
  /**
   * `slug` is Shirabe's own id for the word, present once the hover card has
   * loaded one. It beats the surface because it has already picked the
   * homograph, but it is an id Shirabe issued: no other dictionary can be
   * handed it, so every other preset builds its url from `word`.
   */
  buildUrl: (word: string, reading: string, slug?: string) => string;
  defaultEnabled: boolean;
};

const DICTIONARY_PRESETS: DictionaryPreset[] = [
  {
    id: 'jisho',
    label: 'Jisho',
    buildUrl: (word) => `https://jisho.org/search/${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    id: 'jpdb',
    label: 'JPDB',
    buildUrl: (word) => `https://jpdb.io/search?q=${encodeURIComponent(word)}`,
    defaultEnabled: false,
  },
  {
    // The dictionary behind the hover card itself, so it is where a reader who
    // wants more than the card holds lands by default. A web page rather than
    // the `shirabelookup://` app scheme this used to be: a scheme with no app
    // installed fails silently, and the card is already on the web.
    id: 'shirabe',
    label: 'shirabe.org',
    buildUrl: (word, _reading, slug) => `https://shirabe.org/word/${encodeURIComponent(slug ?? word)}`,
    defaultEnabled: true,
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

// The cookie stores ids, and anything not in this set is dropped from it on the
// next read. So a preset is retired by leaving it here: delete one and every
// reader who had chosen it loses that choice the next time they change any
// other, silently. Turning one off by default only affects readers who have
// never set the preference at all, which is what `decodeEnabled` falls back to.
const VALID_IDS = new Set<string>(DICTIONARY_PRESETS.map((d) => d.id));
const COOKIE_NAME = 'nd_dict_links';

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
  const { state: enabledDictionaries, set } = useCookiePreference<DictionaryId[]>(
    COOKIE_NAME,
    'dictionary-links-enabled',
    {
      parse: decodeEnabled,
      // An empty string, not `null`: "every dictionary off" has to be tellable
      // from "never chose", which is what `decodeEnabled` falls back on.
      serialize: (ids) => ids.join(','),
    },
  );

  const setDictionaryEnabled = (id: DictionaryId, enabled: boolean) => {
    const next = new Set(enabledDictionaries.value);
    if (enabled) next.add(id);
    else next.delete(id);
    set(DICTIONARY_PRESETS.filter((d) => next.has(d.id)).map((d) => d.id));
  };

  const isDictionaryEnabled = (id: DictionaryId) => enabledDictionaries.value.includes(id);

  return {
    presets: DICTIONARY_PRESETS,
    enabledDictionaries,
    isDictionaryEnabled,
    setDictionaryEnabled,
  };
}
