import type { Definition } from '@shirabe-org/card/word-card';
import { describe, expect, test } from 'vitest';
import { minedWordFromShirabeCard } from './shirabeWordMining';
import type { EnrichedToken } from './tokenEnrichment';

describe('Shirabe card Anki fields', () => {
  test('mines the chosen definition and marks its sentence without trusting dictionary HTML', () => {
    const definition = {
      headword: '食べる',
      reading: 'たべる',
      furigana: [{ text: '食', ruby: 'た' }, { text: 'べる' }],
      url: 'https://shirabe.org/en/word/jmdict%3A1',
      common: true,
      jlpt: 'N5',
      frequency: 31,
      pitch: [{ downstep: 2, audioUrl: 'https://cdn.example/audio.mp3' }],
      senses: [
        {
          ref: 'jmdict#0',
          partsOfSpeech: [{ label: 'Verb', code: 'v1', category: 'pos' }],
          tags: [],
          glosses: [{ lang: 'eng', tag: 'EN', text: 'to <eat> & drink' }],
        },
      ],
    } as unknown as Definition;
    const token = { s: '食べた', b: 2, e: 5, dictForm: '食べる', readingHiragana: 'たべた' } as EnrichedToken;
    const mined = minedWordFromShirabeCard(definition, token, '私が食べた。');

    expect(mined).toMatchObject({
      word: '食べる',
      reading: 'たべる',
      furigana: '食[た]べる',
      frequency: '31',
      jlpt: 'N5',
      pitchPositions: '2',
      audioFilename: 'nadeshiko-word-たべる-2.mp3',
      sentenceHighlight: '<div>私が<b class="nd-target">食べた</b>。</div>',
    });
    expect(mined?.definition).toContain('to &lt;eat&gt; &amp; drink');
    expect(mined?.definition).toContain('View on shirabe.org');
    expect(mined?.definitionsByDictionary.jmdict).toContain('to &lt;eat&gt; &amp; drink');
    expect(mined?.definitionFirst).toContain('to &lt;eat&gt; &amp; drink');
  });

  test('keeps parser context when the dictionary has no entry', () => {
    const token = { s: '走った', b: 0, e: 3, dictForm: '走る', readingHiragana: 'はしった' } as EnrichedToken;
    expect(minedWordFromShirabeCard(null, token, '走った')).toMatchObject({
      word: '走る',
      reading: 'はしった',
      definition: '',
      sentenceHighlight: '<div><b class="nd-target">走った</b></div>',
    });
  });

  test('exports only the dictionaries picked in Nadeshiko', () => {
    const definition = {
      headword: '天気',
      reading: 'てんき',
      pitch: [],
      senses: [
        {
          ref: 'jmdict#0',
          dictionary: 'JMdict',
          partsOfSpeech: [],
          tags: [],
          glosses: [{ lang: 'eng', tag: 'EN', text: 'weather' }],
        },
        {
          ref: 'daijirin#0',
          dictionary: '大辞林',
          partsOfSpeech: [],
          tags: [],
          glosses: [{ lang: 'jpn', tag: 'JA', text: '空模様' }],
        },
      ],
    } as unknown as Definition;
    const token = { s: '天気', b: 0, e: 2, dictForm: '天気', readingHiragana: 'てんき' } as EnrichedToken;
    const mined = minedWordFromShirabeCard(definition, token, '天気', new Set(['daijirin']));
    expect(mined?.definition).toContain('空模様');
    expect(mined?.definition).not.toContain('weather');
    expect(mined?.pickedDictionaries).toBe(1);
  });

  test('preserves Shirabe publisher sections and usage notes in safe Anki markup', () => {
    const definition = {
      headword: '今日',
      reading: 'きょう',
      pitch: [],
      senses: [
        {
          partsOfSpeech: [],
          tags: [],
          glosses: [
            { lang: 'eng', tag: 'EN', text: 'today' },
            { lang: 'eng', tag: 'EN', text: 'this day' },
            { lang: 'jpn', tag: 'JA', title: '意味', text: '今日のこと' },
          ],
          usages: [{ lang: 'jpn', tag: 'JA', title: '用例', text: '今日も晴れ' }],
          notes: ['Often written <今日>'],
        },
      ],
    } as unknown as Definition;
    const token = { s: '今日', b: 0, e: 2, dictForm: '今日', readingHiragana: 'きょう' } as EnrichedToken;
    const html = minedWordFromShirabeCard(definition, token, '今日')?.definition ?? '';
    expect(html).toContain('today; this day');
    expect(html).toContain('nd-gloss-lang">JA');
    expect(html).toContain('nd-gloss-title">意味');
    expect(html).toContain('nd-gloss-title">用例');
    expect(html).toContain('Often written &lt;今日&gt;');
    expect(html).not.toContain('<今日>');
  });
});
