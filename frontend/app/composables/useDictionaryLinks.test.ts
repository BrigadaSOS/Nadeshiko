import { describe, expect, it } from 'vitest';
import { DICTIONARY_PRESETS } from '~/composables/useDictionaryLinks';

const preset = (id: string) => {
  const found = DICTIONARY_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
};

describe('dictionary presets', () => {
  // shirabe.org serves its word pages under /en/ and /es/, and a url without a
  // locale answers 302 to /en/ whatever the reader is reading in -- so a Spanish
  // reader was quietly sent to the English page. There were two builders for
  // this one destination and only the unused one got it right.
  it('sends a reader to shirabe.org in their own language', () => {
    const url = preset('shirabe').buildUrl('焼ける', 'やける', '焼ける-やける', 'es');

    expect(url).toContain('/es/word/');
    expect(url).not.toContain('/en/');
  });

  // The slug has already picked the homograph; the surface has not.
  it('prefers the resolved id over the surface, and falls back when there is none', () => {
    expect(preset('shirabe').buildUrl('開く', 'ひらく', '開く-ひらく', 'en')).toContain(
      encodeURIComponent('開く-ひらく'),
    );
    expect(preset('shirabe').buildUrl('開く', 'ひらく', undefined, 'en')).toContain(encodeURIComponent('開く'));
  });

  // Every other dictionary is single-language or negotiates for itself, so the
  // locale must not leak into their urls.
  it('keeps the locale out of the other dictionaries', () => {
    for (const id of ['jisho', 'jpdb', 'weblio', 'takoboto']) {
      const url = preset(id).buildUrl('焼ける', 'やける', '焼ける-やける', 'es');

      expect(url, id).not.toContain('/es/');
      expect(url, id).toContain(encodeURIComponent('焼ける'));
    }
  });
});
