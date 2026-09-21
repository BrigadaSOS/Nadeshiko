// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import type { EnrichedToken } from './tokenEnrichment';
import type { GlossPreference } from './wordCard';
import { cardTokenAttributes } from '@shirabe-org/card/word-card/host';
import { createNadeshikoWordCardHost, toShirabeCardToken } from './shirabeWordCardHost';

const preference: GlossPreference = {
  order: ['en'],
  fallback: ['es'],
  labels: 'en' as const,
};

function token(): EnrichedToken {
  return {
    s: '食べました',
    d: '食べる',
    r: 'タベマシタ',
    b: 2,
    e: 7,
    p: '動詞',
    kind: 'inflected',
    inflection: { labels: ['past', 'polite'], base: '食べる' },
    matchType: 'match',
    displaySurface: '食べました',
    dictForm: '食べる',
    readingHiragana: 'たべました',
    inflectionLabels: ['past', 'polite'],
    furigana: [
      { text: '食', reading: 'た' },
      { text: 'べました', reading: '' },
    ],
    highlightRanges: [],
  };
}

describe('Nadeshiko Shirabe word-card host', () => {
  test('passes the UTF-16 target span without POS metadata', () => {
    expect(toShirabeCardToken(token())).toEqual({
      surface: '食べました',
      start: 2,
      length: 5,
      inflection: ['past', 'polite'],
      inflectionBase: '食べる',
      content: true,
    });

    expect(cardTokenAttributes(toShirabeCardToken(token()), '昨日食べました。')).toMatchObject({
      'data-lemma': '食べました',
      'data-surface': '食べました',
      'data-target-start': '2',
      'data-target-end': '7',
      'data-sentence': '昨日食べました。',
    });
    expect(cardTokenAttributes(toShirabeCardToken(token()), '昨日食べました。')).not.toHaveProperty('data-lookup-pos');
  });

  test('does not treat parser morphemes as dictionary expression parts', () => {
    const grouped = {
      ...token(),
      parts: [
        { s: 'いい', b: 0, e: 2 },
        { s: '天気', b: 2, e: 4 },
      ],
    };
    expect(cardTokenAttributes(toShirabeCardToken(grouped))).not.toHaveProperty('data-parts');
  });

  test('keeps a target in view when its sentence exceeds Shirabe’s text limit', async () => {
    const lookupWordAt = vi.fn().mockResolvedValue({ candidates: [] });
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt,
    });
    const text = `${'あ'.repeat(120)}猫${'い'.repeat(120)}`;

    await host.lookup('猫', 'word', { surface: '猫', text, startOffset: 120, endOffset: 121 });

    const target = lookupWordAt.mock.calls[0]![0];
    expect(target.text).toHaveLength(200);
    expect(target.text.slice(target.startOffset, target.endOffset)).toBe('猫');
  });

  test('maps Nadeshiko proxy candidates into the generic card contract', async () => {
    const lookupWordAt = vi.fn().mockResolvedValue({
      candidates: [
        {
          id: 'jmdict:1358280',
          headword: '食べる',
          reading: 'たべる',
          common: true,
          jlpt: 'N5',
          frequency: 31,
          pitch: [{ downstep: 2, audioUrl: null }],
          parts: [{ text: '食', lemma: '食', id: 'jmdict:food' }],
          entries: [
            {
              dictionary: 'jmdict',
              dictionaryName: 'JMdict',
              senses: [
                {
                  position: 0,
                  definitions: [{ lang: 'en', text: 'to eat' }],
                  tags: [{ category: 'partOfSpeech', code: 'v1', label: 'Ichidan verb' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      dictionaryReveal: () => ({ jmdict: 'hover' }),
      lookupWordAt,
    });

    const result = await host.lookup('食べる', 'word', {
      surface: '食べました',
      text: '昨日食べました。',
      startOffset: 2,
      endOffset: 7,
    });
    if (result.status === 'found') expect(result.definition?.hiddenGlossLanguages).toBeUndefined();

    expect(lookupWordAt).toHaveBeenCalledWith({ text: '昨日食べました。', startOffset: 2, endOffset: 7 }, 'en');
    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected a found result');
    expect(result.definition).toMatchObject({
      headword: '食べる',
      url: 'http://shirabe.localhost/en/word/jmdict%3A1358280',
      sourceForm: '食べました',
      common: true,
      jlpt: 'N5',
      senses: [
        {
          covered: true,
          dictionary: 'JMdict',
          partsOfSpeech: [{ label: 'Ichidan' }],
          glosses: [{ lang: 'eng', tag: 'EN', text: 'to eat' }],
        },
      ],
      parts: [{ text: '食', lemma: '食', entry: 'jmdict:food' }],
    });
    expect(result.alternatives).toMatchObject([{ entry: 'jmdict:1358280', headword: '食べる' }]);
  });

  test('keeps ranked name matches for the SDK to group', async () => {
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt: vi.fn().mockResolvedValue({
        candidates: [
          { id: 'jmdict:1', headword: '君', reading: 'キミ', entries: [] },
          { id: 'jmnedict:2', headword: 'キミ', reading: 'キミ', name: true, entries: [] },
        ],
      }),
    });

    const result = await host.lookup('君', 'word');
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.alternatives?.map((definition) => [definition.headword, definition.name ?? false])).toEqual([
      ['君', false],
      ['キミ', true],
    ]);
  });

  test('shows the matched spelling when a kana token finds an entry with a different usual headword', async () => {
    const onDefinition = vi.fn();
    const pronoun = { id: 'あなた', headword: 'あなた', reading: 'アナタ', entries: [] };
    const beyond = {
      id: 'かなた',
      headword: 'かなた',
      matchedHeadword: '彼方',
      reading: 'アナタ',
      forms: [
        { text: 'かなた', common: true },
        { text: '彼方', common: true },
        { text: 'あなた', common: false },
      ],
      entries: [],
    };
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt: vi.fn().mockResolvedValue({ candidates: [pronoun, beyond] }),
      onDefinition,
    });

    const first = await host.lookup('あなた', 'word');
    expect(first).toMatchObject({ definition: { headword: 'あなた' } });
    expect(first).toMatchObject({
      alternatives: [{ headword: 'あなた' }, { headword: '彼方', reading: 'あなた' }],
    });
    if (first.status !== 'found') throw new Error('expected found result');
    host.onVisibleDefinition?.(first.alternatives![1]!);
    expect(onDefinition).toHaveBeenLastCalledWith(expect.objectContaining({ headword: '彼方' }));
    expect(host.kanjiUrl?.('彼')).toBe('http://shirabe.localhost/en/kanji/%E5%BD%BC');

    const selected = await host.lookupEntry('かなた', 'あなた');
    expect(selected).toMatchObject({
      definition: {
        headword: '彼方',
        reading: 'あなた',
        entry: 'かなた',
        url: 'http://shirabe.localhost/en/word/%E3%81%8B%E3%81%AA%E3%81%9F',
        sourceForm: 'あなた',
        baseForm: '彼方',
        baseReading: 'あなた',
        forms: [{ text: 'かなた', common: true }],
      },
    });
  });

  test('uses Spanish tags with English glosses and English tags for other UI languages', async () => {
    const answer = {
      candidates: [
        {
          id: 'jmdict:1',
          headword: 'あれ',
          reading: 'あれ',
          entries: [
            {
              dictionary: 'jmdict',
              senses: [
                {
                  definitions: [{ lang: 'en', text: 'that' }],
                  tags: [{ category: 'misc', code: 'uk', label: 'word usually written in kana' }],
                },
              ],
            },
          ],
        },
      ],
    };
    for (const [uiLocale, label, fullLabel] of [
      ['es', 'Solo kana', 'Normalmente en kana'],
      ['zh', 'Kana only', 'Usually kana'],
      ['ja', 'Kana only', 'Usually kana'],
    ] as const) {
      const host = createNadeshikoWordCardHost({
        glossPreference: () => preference,
        uiLocale: () => uiLocale,
        shirabeSite: 'http://shirabe.localhost',
        lookupWordAt: vi.fn().mockResolvedValue(answer),
      });
      const result = await host.lookup('あれ', 'word');
      expect(result.status).toBe('found');
      if (result.status !== 'found') continue;
      expect(result.definition?.senses[0]?.glosses[0]?.text).toBe('that');
      expect(result.definition?.senses[0]?.tags[0]).toMatchObject({
        label,
        presentation: { shortLabel: label, fullLabel, explanation: expect.any(String) },
      });
    }
  });

  test('keeps publisher numbering and content from a personal dictionary', async () => {
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt: vi.fn().mockResolvedValue({
        candidates: [
          {
            id: '生-せい',
            headword: '生',
            reading: 'セイ',
            entries: [
              {
                dictionary: 'yomitan-c89af12122021a8a',
                dictionaryName: '三省堂国語辞典',
                sourceId: '42',
                senses: [
                  {
                    position: 0,
                    depth: 0,
                    label: '一',
                    definitions: [{ lang: 'ja', text: 'いきていること', title: '生命' }],
                    tags: [{ category: 'partOfSpeech', code: 'n', label: 'noun', scope: 'group' }],
                  },
                  {
                    position: 2,
                    depth: 1,
                    label: '一㋐',
                    definitions: [{ lang: 'ja', text: 'うまれること' }],
                    usages: [{ lang: 'ja', text: '生を受ける' }],
                    notes: ['出生の意'],
                    related: [{ text: '出生', reading: 'しゅっしょう' }],
                  },
                ],
              },
              {
                dictionary: 'jmdict',
                dictionaryName: 'JMdict',
                sourceId: '123',
                senses: [{ position: 0, definitions: [{ lang: 'en', text: 'life' }] }],
              },
            ],
          },
        ],
      }),
    });

    const result = await host.lookup('生', 'word');
    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected a found result');
    expect(result.definition?.senses).toMatchObject([
      {
        position: 0,
        depth: 0,
        label: '一',
        dictionary: '三省堂国語辞典',
        sourceEntry: 'yomitan-c89af12122021a8a:42',
        glosses: [{ lang: 'jpn', text: 'いきていること', title: '生命' }],
        groupTags: [{ code: 'n' }],
      },
      {
        position: 2,
        depth: 1,
        label: '一㋐',
        dictionary: '三省堂国語辞典',
        sourceEntry: 'yomitan-c89af12122021a8a:42',
        glosses: [{ lang: 'jpn', text: 'うまれること' }],
        usages: [{ lang: 'jpn', text: '生を受ける' }],
        notes: ['出生の意'],
        xrefs: [{ kind: 'related', text: '出生', reading: 'しゅっしょう' }],
      },
      { dictionary: 'JMdict', glosses: [{ lang: 'eng', text: 'life' }] },
    ]);
  });

  test('a linked reader receives every definition in their Shirabe stack', async () => {
    const host = createNadeshikoWordCardHost({
      glossPreference: () => ({ order: ['es'], fallback: [], labels: 'es' }),
      shirabeSite: 'http://shirabe.localhost',
      linked: () => true,
      lookupWordAt: vi.fn().mockResolvedValue({
        candidates: [
          {
            id: '猫-ねこ',
            headword: '猫',
            entries: [
              {
                dictionary: 'jmdict',
                sourceId: '1',
                senses: [{ position: 0, definitions: [{ lang: 'en', text: 'cat' }] }],
              },
              {
                dictionary: 'personal',
                dictionaryName: 'My dictionary',
                sourceId: '2',
                senses: [{ position: 0, definitions: [{ lang: 'fr', text: 'chat' }] }],
              },
            ],
          },
        ],
      }),
    });

    const result = await host.lookup('猫', 'word');
    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected a found result');
    expect(result.definition?.senses.map((sense) => sense.glosses.map((gloss) => gloss.text))).toEqual([
      ['cat'],
      ['chat'],
    ]);
  });

  test('an unlinked reader applies Nadeshiko language visibility to every source', async () => {
    const host = createNadeshikoWordCardHost({
      glossPreference: () => ({ order: ['es'], fallback: [], labels: 'es' }),
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt: vi.fn().mockResolvedValue({
        candidates: [
          {
            id: 'word',
            headword: '猫',
            entries: [
              {
                dictionary: 'another-source',
                senses: [
                  {
                    definitions: [
                      { lang: 'en', text: 'cat' },
                      { lang: 'es', text: 'gato' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    const result = await host.lookup('猫', 'word');
    expect(result).toMatchObject({ definition: { senses: [{ glosses: [{ text: 'gato' }] }] } });
  });

  test('keeps transport failures distinct from missing dictionary entries', async () => {
    const failed = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt: vi.fn().mockResolvedValue({ candidates: [], reason: 'failed' }),
    });
    const missing = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt: vi.fn().mockResolvedValue({ candidates: [], reason: 'missing' }),
    });

    await expect(failed.lookup('猫', 'word')).resolves.toEqual({
      status: 'failed',
      message: 'Could not load definitions. Please try again later.',
    });
    await expect(missing.lookup('猫', 'word')).resolves.toEqual({ status: 'found', definition: null });
  });

  test('prefetch warms the same lookup without selecting a candidate', async () => {
    const lookupWordAt = vi.fn().mockResolvedValue({ candidates: [] });
    const onDefinition = vi.fn();
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt,
      onDefinition,
    });
    await host.prefetch?.('食べる', 'word', {
      surface: '食べました',
      text: '食べました',
      startOffset: 0,
      endOffset: 5,
    });
    expect(lookupWordAt).toHaveBeenCalledWith({ text: '食べました', startOffset: 0, endOffset: 5 }, 'en');
    expect(onDefinition).not.toHaveBeenCalled();
  });

  test('keeps candidate choices scoped to the word that opened them', async () => {
    const cat = { id: 'jmdict:cat', headword: '猫', reading: 'ねこ', entries: [] };
    const dog = { id: 'jmdict:dog', headword: '犬', reading: 'いぬ', entries: [] };
    const lookupWordAt = vi
      .fn()
      .mockResolvedValueOnce({ candidates: [cat] })
      .mockResolvedValueOnce({ candidates: [dog] });
    const host = createNadeshikoWordCardHost({
      glossPreference: () => preference,
      shirabeSite: 'http://shirabe.localhost',
      lookupWordAt,
    });

    await host.lookup('猫', 'word');
    await host.lookup('犬', 'word');
    const result = await host.lookupEntry('jmdict:dog', '犬');

    expect(result).toMatchObject({
      status: 'found',
      definition: { entry: 'jmdict:dog', headword: '犬' },
    });
  });
});
