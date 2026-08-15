import { describe, expect, it } from 'vitest';
import {
  definitionHtml,
  definitionSourceHtml,
  escapeHtml,
  highlightedSentence,
  infoHtml,
  minedWord,
  pitchAudioFilename,
  pitchHtml,
} from './ankiWord';
import type { EnrichedToken } from './tokenEnrichment';
import { glossPreference, type GlossPreference, type ShirabeWord } from './wordCard';

/**
 * What lands on the note.
 *
 * These assert strings rather than parsed DOM on purpose: the field IS a string
 * to Anki, and the failures worth catching here -- a gloss escaped twice, a
 * bracket that swallowed the okurigana, an overline over the wrong morae -- are
 * all visible in the string and all invisible in a DOM comparison that
 * normalises them away.
 */

const EN: GlossPreference = glossPreference('en', { en: 'show', es: 'show' });

const TEKAGEN: ShirabeWord = {
  id: 'tekagen',
  headword: '手加減',
  reading: 'てかげん',
  common: true,
  jlpt: 'N1',
  frequency: 12345,
  furigana: [{ text: '手加減', ruby: 'てかげん' }],
  pitch: [{ downstep: 0, audioUrl: 'https://cdn.shirabe.org/pitch/tekagen-0.mp3' }],
  entries: [
    {
      dictionary: 'jmdict',
      senses: [
        {
          definitions: [{ lang: 'en', text: 'allowance' }],
          tags: [
            {
              category: 'partOfSpeech',
              code: 'n',
              label: 'noun (common) (futsuumeishi)',
            },
          ],
        },
      ],
    },
  ],
};

const token = (over: Partial<EnrichedToken> = {}): EnrichedToken =>
  ({
    dictForm: '手加減',
    readingHiragana: 'てかげん',
    ...over,
  }) as EnrichedToken;

describe('escapeHtml', () => {
  it('escapes the ampersand JMdict carries in ordinary definitions', () => {
    expect(escapeHtml('salt & pepper')).toBe('salt &amp; pepper');
  });

  it('escapes angle brackets and quotes, so a gloss cannot open a tag', () => {
    expect(escapeHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(escapeHtml('a "b"')).toBe('a &quot;b&quot;');
  });

  it('escapes the ampersand first, so an escape is never escaped twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('definitionHtml', () => {
  it('numbers the senses and badges each gloss with its language', () => {
    const html = definitionHtml([
      {
        partsOfSpeech: [{ label: 'Noun', title: 'noun', category: 'partOfSpeech' }],
        tags: [],
        glosses: [{ lang: 'en', label: 'EN', text: 'allowance' }],
      },
    ]);
    // Asserted by structure rather than as one exact string: the inline styles
    // that make this render in Anki are long, and pinning them byte-for-byte
    // would make every colour tweak a test edit without catching anything.
    expect(html).toMatch(/^<ol class="nd-senses" style="[^"]+">/);
    expect(html).toContain('<li class="nd-sense"');
    expect(html).toContain('>Noun</span>');
    expect(html).toContain('>EN</span>allowance</span>');
    expect(html.endsWith('</li></ol>')).toBe(true);
  });

  /**
   * The declaration the bug report was about.
   *
   * Without `display:block` on each gloss row the languages run together --
   * "ground crewESmecánico de mantenimiento" -- which is exactly how this
   * shipped before the styles moved inline. Anki's editor applies none of the
   * note type's Styling, so a class alone could never have fixed it there.
   */
  it('puts every gloss on its own line, inline, so Anki renders it unaided', () => {
    const html = definitionHtml([
      {
        partsOfSpeech: [{ label: 'Noun', title: 'noun', category: 'partOfSpeech' }],
        tags: [],
        glosses: [
          {
            lang: 'en',
            label: 'EN',
            text: 'maintenance engineer; ground crew',
          },
          { lang: 'es', label: 'ES', text: 'mecánico de mantenimiento' },
        ],
      },
    ]);

    const glossOpeners = html.match(/<span class="nd-gloss" style="[^"]*"/g) ?? [];
    expect(glossOpeners).toHaveLength(2);
    for (const opener of glossOpeners) expect(opener).toContain('display:block');

    // And the language badge is a box, not bare text against the gloss.
    expect(html).toMatch(/<span class="nd-gloss-lang" style="[^"]*border:[^"]*">EN<\/span>/);
  });

  it('keeps parts of speech and usage qualifiers in separate classes', () => {
    const html = definitionHtml([
      {
        partsOfSpeech: [{ label: 'Noun', title: 'noun', category: 'partOfSpeech' }],
        tags: [
          {
            label: 'Usually kana',
            title: 'usually written using kana alone',
            category: 'misc',
          },
        ],
        glosses: [{ lang: 'en', label: 'EN', text: 'allowance' }],
      },
    ]);
    expect(html).toMatch(/<span class="nd-pos" style="[^"]*" title="noun">Noun<\/span>/);
    expect(html).toMatch(/<span class="nd-tag [^"]*" style="[^"]*" title="usually written using kana alone">/);
  });

  /**
   * A usage qualifier must not read as a grammatical category, which on the
   * on-screen card is done with colour -- "Military" is a field, and blue,
   * while "Noun" is a part of speech, and pink. Collapsing every tag to one grey
   * loses information the card was carrying.
   */
  it('colours a field tag differently from a part of speech', () => {
    const html = definitionHtml([
      {
        partsOfSpeech: [{ label: 'Noun', title: 'noun', category: 'partOfSpeech' }],
        tags: [{ label: 'Military', title: 'military', category: 'field' }],
        glosses: [{ lang: 'en', label: 'EN', text: 'ground crew' }],
      },
    ]);

    expect(html).toContain('#f472b6');
    expect(html).toContain('#60a5fa');
    expect(html).toContain('nd-tag--field');
  });

  it('escapes gloss text and the chip tooltip', () => {
    const html = definitionHtml([
      {
        partsOfSpeech: [{ label: 'N', title: 'a & b', category: 'partOfSpeech' }],
        tags: [],
        glosses: [{ lang: 'en', label: 'EN', text: 'salt & pepper' }],
      },
    ]);
    expect(html).toContain('title="a &amp; b"');
    expect(html).toContain('salt &amp; pepper');
  });

  // An empty string is the signal the store leaves the field alone on, so it
  // must not be an empty <ol> that would blank a definition Yomitan wrote.
  it('renders nothing at all when there are no senses', () => {
    expect(definitionHtml([])).toBe('');
  });
});

describe('definitionSourceHtml', () => {
  it('links the resolved word page in the reader own locale', () => {
    const html = definitionSourceHtml(TEKAGEN, 'es');

    expect(html).toContain('class="nd-source"');
    expect(html).toContain('View on shirabe.org');
    expect(html).toContain('https://shirabe.org/es/word/tekagen');
    expect(html).not.toContain('/en/word/');
  });

  it('attributes the visit as coming from an Anki note, not the hover card', () => {
    const href = /href="([^"]+)"/.exec(definitionSourceHtml(TEKAGEN, 'en'))?.[1];
    expect(href).toBeDefined();
    const params = new URL(href!.replaceAll('&amp;', '&')).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      utm_source: 'nadeshiko',
      utm_medium: 'referral',
      utm_content: 'anki-definition',
    });
  });

  it('escapes the href, so a query string cannot break the attribute', () => {
    const html = definitionSourceHtml(TEKAGEN, 'en');
    expect(html).toContain('utm_source=nadeshiko&amp;utm_medium=referral');
    expect(html).not.toMatch(/href="[^"]*&utm_/);
  });

  it('renders nothing without an id, so a half-built word cannot invent a url', () => {
    expect(definitionSourceHtml({ id: '', headword: '手加減' }, 'en')).toBe('');
  });
});

describe('pitchHtml', () => {
  it('marks heiban high from the second mora to the end, with no drop', () => {
    const html = pitchHtml('てかげん', 0);
    // The classes carry which morae are high; the inline border is what actually
    // draws the overline in Anki, so both are checked.
    expect(html.match(/nd-mora nd-mora--high/g)).toHaveLength(3);
    expect(html.match(/border-top-color:#db2777/g)).toHaveLength(3);
    expect(html).not.toContain('nd-mora--drop');
    expect(html).toContain('>[0]</span>');
    expect(html.replace(/ style="[^"]*"/g, '')).toBe(
      '<span class="nd-pitch">' +
        '<span class="nd-mora">て</span>' +
        '<span class="nd-mora nd-mora--high">か</span>' +
        '<span class="nd-mora nd-mora--high">げ</span>' +
        '<span class="nd-mora nd-mora--high">ん</span>' +
        '<span class="nd-downstep">[0]</span>' +
        '</span>',
    );
  });

  it('closes the overline on the mora the pitch falls after', () => {
    // Atamadaka: high on the first mora only, which is therefore also the drop.
    const html = pitchHtml('あめ', 1);
    const bare = html.replace(/ style="[^"]*"/g, '');
    expect(bare).toContain('<span class="nd-mora nd-mora--high nd-mora--drop">あ</span>');
    expect(bare).toContain('<span class="nd-mora">め</span>');
    // The closing stroke is a right border, and it has to be inline to be drawn.
    expect(html).toContain('border-right:2px solid #db2777');
  });

  it('keeps a small kana with the mora it belongs to', () => {
    // しゃ is one mora, not two -- counting it twice moves the downstep.
    expect(pitchHtml('しゃかい', 0)).toContain('>しゃ<');
  });
});

describe('infoHtml', () => {
  it('prints the common flag, the JLPT level and the frequency rank', () => {
    expect(infoHtml(TEKAGEN).replace(/ style="[^"]*"/g, '')).toBe(
      '<span class="nd-badges">' +
        '<span class="nd-badge">Common</span>' +
        '<span class="nd-badge">N1</span>' +
        '<span class="nd-badge">#12345</span>' +
        '</span>',
    );
    expect(infoHtml(TEKAGEN)).toContain('border-radius:999px');
  });

  it('renders nothing for a word with no badges', () => {
    expect(infoHtml({ id: 'x', headword: 'x' })).toBe('');
  });
});

describe('pitchAudioFilename', () => {
  it('names the clip by reading and accent, so mining twice overwrites', () => {
    expect(pitchAudioFilename('てかげん', 0, 'https://cdn.shirabe.org/a.mp3')).toBe('nadeshiko-word-てかげん-0.mp3');
  });

  it('keeps the extension the CDN actually served', () => {
    expect(pitchAudioFilename('あめ', 1, 'https://cdn.shirabe.org/a.ogg?v=2')).toBe('nadeshiko-word-あめ-1.ogg');
  });

  it('falls back to mp3 when the URL names no extension', () => {
    expect(pitchAudioFilename('あめ', 1, 'https://cdn.shirabe.org/clip')).toBe('nadeshiko-word-あめ-1.mp3');
  });

  it('drops anything that could escape the filename', () => {
    expect(pitchAudioFilename('../ん', 0, 'https://x/a.mp3')).toBe('nadeshiko-word-ん-0.mp3');
  });
});

describe('minedWord', () => {
  it('renders the whole card off a full lookup', () => {
    const mined = minedWord(TEKAGEN, token(), EN);
    expect(mined.word).toBe('手加減');
    expect(mined.reading).toBe('てかげん');
    expect(mined.furigana).toBe('手加減[てかげん]');
    expect(mined.definition).toContain('allowance');
    expect(mined.definition).toContain('View on shirabe.org');
    expect(mined.definition).toContain('https://shirabe.org/en/word/tekagen');
    expect(mined.pitch).toContain('nd-mora');
    expect(mined.info).toContain('N1');
    expect(mined.audioUrl).toBe('https://cdn.shirabe.org/pitch/tekagen-0.mp3');
    expect(mined.audioFilename).toBe('nadeshiko-word-てかげん-0.mp3');
  });

  // A lookup that failed still leaves the reader looking at a headword, and a
  // card with the word on it beats a card with a blank front.
  it('falls back to what the token itself knows when there is no entry', () => {
    const mined = minedWord(null, token({ dictForm: '走る', readingHiragana: 'はしる' }), EN);
    expect(mined.word).toBe('走る');
    expect(mined.reading).toBe('はしる');
    // Nothing to say about a word the dictionary does not have -- and '' is what
    // tells the store to leave those fields untouched.
    expect(mined.definition).toBe('');
    expect(mined.pitch).toBe('');
    expect(mined.audioUrl).toBeNull();
  });

  it('leaves the reading empty when the headword is already kana', () => {
    const kana: ShirabeWord = { id: 'k', headword: 'ある', reading: 'ある' };
    expect(minedWord(kana, token(), EN).reading).toBe('');
  });

  it('picks the first accent that actually has a recording', () => {
    const word: ShirabeWord = {
      ...TEKAGEN,
      pitch: [
        { downstep: 0, audioUrl: null },
        { downstep: 2, audioUrl: 'https://cdn.shirabe.org/b.mp3' },
      ],
    };
    const mined = minedWord(word, token(), EN);
    expect(mined.audioUrl).toBe('https://cdn.shirabe.org/b.mp3');
    expect(mined.audioFilename).toBe('nadeshiko-word-てかげん-2.mp3');
    // The DIAGRAM still shows the first pattern, which is the one the card
    // shows: the clip is chosen by what exists, the diagram by what is primary.
    expect(mined.pitch).toContain('[0]');
  });

  it('mines nothing at all when there is neither a lookup nor a token', () => {
    expect(minedWord(null, null, EN).word).toBe('');
  });

  it('follows the reader into Spanish', () => {
    const bilingual: ShirabeWord = {
      ...TEKAGEN,
      entries: [
        {
          dictionary: 'jmdict',
          senses: [
            {
              definitions: [
                { lang: 'en', text: 'allowance' },
                { lang: 'es', text: 'indulgencia' },
              ],
            },
          ],
        },
      ],
    };
    const spanish = glossPreference('es', { en: 'hidden', es: 'show' });
    const mined = minedWord(bilingual, token(), spanish);
    expect(mined.definition).toContain('indulgencia');
    expect(mined.definition).not.toContain('allowance');
    expect(mined.definition).toContain('https://shirabe.org/es/word/tekagen');
  });

  it('does not hang a lone source link on an empty definition', () => {
    // A reader who hid every gloss language still has a word, and a link with
    // no senses around it would count as content -- which would overwrite a
    // glossary Yomitan already wrote on the note.
    const none = glossPreference('en', { en: 'hidden', es: 'hidden' });
    expect(minedWord(TEKAGEN, token(), none).definition).toBe('');
  });
});

/**
 * Marking the mined word inside the sentence.
 *
 * The offsets are the whole design. Searching the sentence for the word finds
 * the wrong one -- 手 sits inside 手負い and 相手 alike, and an inflected token's
 * surface is not its dictionary form at all -- so the slice is taken from the
 * token's own `b`/`e`, and verified against its surface before it is trusted.
 */
describe('highlightedSentence', () => {
  const SENTENCE = 'しかし 手負いにでもしたら まずいことになりませんか?';
  const at = (surface: string, extra: Partial<EnrichedToken> = {}) =>
    ({
      s: surface,
      b: SENTENCE.indexOf(surface),
      e: SENTENCE.indexOf(surface) + surface.length,
      ...extra,
    }) as EnrichedToken;

  it('wraps the token that was mined, leaving the rest of the sentence intact', () => {
    const html = highlightedSentence(SENTENCE, at('手負い'));

    // `<b>`, the same element every other miner marks the target word with.
    expect(html).toContain('<b class="nd-target">手負い</b>');
    // Everything either side survives, in order.
    expect(html.replace(/<[^>]+>/g, '')).toBe(SENTENCE);
  });

  it('marks the occurrence the reader clicked, not the first one that matches', () => {
    // 手 appears inside 手負い before it appears on its own. A search-and-replace
    // would mark the wrong one and quietly split the compound.
    const sentence = '手負いの手';
    const token = { s: '手', b: 4, e: 5 } as EnrichedToken;

    const html = highlightedSentence(sentence, token);

    expect(html).toBe('<div>手負いの<b class="nd-target">手</b></div>');
  });

  it('falls back to the plain sentence when the offsets do not describe it', () => {
    // An expanded segment re-bases the offsets. A token addressing a different
    // string must not be used to cut this one -- the sentence would come back
    // sliced in the wrong place, and nothing would report it.
    const stale = { s: '手負い', b: 40, e: 43 } as EnrichedToken;

    expect(highlightedSentence(SENTENCE, stale)).toBe(`<div>${SENTENCE}</div>`);
    expect(
      highlightedSentence(SENTENCE, {
        s: '別の語',
        b: 3,
        e: 6,
      } as EnrichedToken),
    ).toBe(`<div>${SENTENCE}</div>`);
  });

  it('is the plain sentence when no word was mined, and empty when there is no sentence', () => {
    expect(highlightedSentence(SENTENCE, null)).toBe(`<div>${SENTENCE}</div>`);
    expect(highlightedSentence('', at('手負い'))).toBe('');
  });

  it('escapes the sentence, which comes from arbitrary subtitles', () => {
    const sentence = 'a<b & "c" 手負い';
    const html = highlightedSentence(sentence, {
      s: '手負い',
      b: 10,
      e: 13,
    } as EnrichedToken);

    expect(html).toContain('a&lt;b &amp; &quot;c&quot;');
    expect(html).not.toContain('<b &');
  });

  it('rides along on the mined word, so the store only substitutes', () => {
    const mined = minedWord(TEKAGEN, token({ s: '手加減', b: 0, e: 3 }), EN, '手加減してください');
    expect(mined.sentenceHighlight).toContain('nd-target');
    expect(mined.sentenceHighlight).toContain('<b class="nd-target">手加減</b>してください');

    // A token carrying no offsets -- the shared fixture -- declines rather than
    // guessing, and the sentence still lands, plain.
    expect(minedWord(TEKAGEN, token(), EN, '手加減してください').sentenceHighlight).toBe(
      '<div>手加減してください</div>',
    );

    // And a mine with no sentence to hand leaves it empty rather than absent.
    expect(minedWord(TEKAGEN, token(), EN).sentenceHighlight).toBe('');
  });
});

/**
 * The accent position as plain text.
 *
 * Its own field because the diagram cannot serve as one. A card template that
 * parses its pitch field for digits reads the numbers inside our inline styles
 * -- `padding:1px 0`, `line-height:1.4`, `#db2777` -- and renders the word as
 * though it had five accents: the `1・0・4・2・2777・5・11・9` a reader reported
 * from a Lapis note. Plain text cannot be misread that way, which is the whole
 * reason this exists rather than the reader pointing their number field at the
 * graph.
 */
describe('pitchPositions', () => {
  const withPitch = (pitch: unknown) => ({ ...TEKAGEN, pitch }) as ShirabeWord;

  it('is the bare number, with none of the markup the diagram carries', () => {
    const mined = minedWord(withPitch([{ downstep: 3 }]), token(), EN);

    expect(mined.pitchPositions).toBe('3');
    expect(mined.pitchPositions).not.toContain('<');
    expect(mined.pitchPositions).not.toContain('px');
    // The digits that were being mistaken for accents live only in the diagram.
    expect(mined.pitch).toContain('2777');
    expect(mined.pitchPositions).not.toContain('2777');
  });

  it('lists every accent the dictionary gives, comma separated', () => {
    expect(minedWord(withPitch([{ downstep: 0 }, { downstep: 3 }]), token(), EN).pitchPositions).toBe('0, 3');
  });

  it('is empty when the word has no accent recorded, so the field is left alone', () => {
    expect(minedWord(withPitch([]), token(), EN).pitchPositions).toBe('');
    expect(minedWord(withPitch(undefined), token(), EN).pitchPositions).toBe('');
  });
});
