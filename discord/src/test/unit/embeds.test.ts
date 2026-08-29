import { describe, test, expect } from 'vitest';

import { buildSegmentMessage, formatTimestamp, getMediaName, stripAllHtmlTags } from '../../embeds';
import { makeSegment, makeMedia } from '../mocks/fixtures';

/** Discord rejects message content longer than this. `buildSegmentMessage` caps at it. */
const DISCORD_CONTENT_LIMIT = 2000;

const media = makeMedia({ publicId: 'media-1', nameRomaji: 'Oshi No Ko', nameJa: '推しの子' });

describe('buildSegmentMessage length', () => {
  test('a long sentence comes back within Discord’s limit, not two over it', () => {
    // The regression this guards: the ellipsis was added on top of the budget
    // rather than taken out of it, so truncating produced `max + 2` characters.
    // At a cap of exactly 2000 that is a message the API refuses -- the command
    // failed outright instead of showing a shortened reply.
    const segment = makeSegment({ textJa: { content: 'あ'.repeat(5000), highlight: '' } });

    const message = buildSegmentMessage(segment, media);

    expect(message.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
    expect(message.endsWith('...')).toBe(true);
  });

  test('a message that already fits is left exactly as it is', () => {
    const segment = makeSegment({ textJa: { content: '短い', highlight: '' } });

    const message = buildSegmentMessage(segment, media);

    expect(message.length).toBeLessThan(DISCORD_CONTENT_LIMIT);
    expect(message.endsWith('...')).toBe(false);
  });
});

describe('buildSegmentMessage translations', () => {
  const segment = makeSegment({
    textJa: { content: '食べたい', highlight: '' },
    textEn: { content: 'I want to eat', isMachineTranslated: false },
    textEs: { content: 'Quiero comer', isMachineTranslated: true },
  });

  test('hides both translations behind spoiler bars', () => {
    // The reason the bot is useful for study at all: the Japanese is readable
    // and the answer is not, until you ask for it.
    const message = buildSegmentMessage(segment, media);

    expect(message).toContain('||I want to eat||');
    expect(message).toContain('||Quiero comer||');
  });

  test('marks a machine translation and leaves a human one unmarked', () => {
    const message = buildSegmentMessage(segment, media);

    expect(message).toContain('**EN**:');
    expect(message).toContain('**ES (MT)**:');
  });

  test.each([
    ['en', true, false],
    ['es', false, true],
    ['both', true, true],
    ['none', false, false],
  ] as const)('language %s shows en=%s es=%s', (language, showsEn, showsEs) => {
    const message = buildSegmentMessage(segment, media, { language });

    expect(message.includes('I want to eat')).toBe(showsEn);
    expect(message.includes('Quiero comer')).toBe(showsEs);
  });

  test('always shows the Japanese, whatever the language setting', () => {
    for (const language of ['en', 'es', 'both', 'none'] as const) {
      expect(buildSegmentMessage(segment, media, { language })).toContain('食べたい');
    }
  });

  test('omits a translation that is empty rather than printing empty spoiler bars', () => {
    const noEnglish = makeSegment({ textEn: { content: '' }, textEs: { content: 'Hola' } });

    const message = buildSegmentMessage(noEnglish, media);

    expect(message).not.toContain('**EN');
    expect(message).toContain('||Hola||');
  });
});

describe('buildSegmentMessage markup', () => {
  test('turns the search highlight into bold and drops every other tag', () => {
    const segment = makeSegment({
      textJa: { content: '食べたい', highlight: '<em>食べ</em><b>たい</b>' },
    });

    const message = buildSegmentMessage(segment, media);

    expect(message).toContain('**食べ**たい');
    expect(message).not.toContain('<b>');
    expect(message).not.toContain('<em>');
  });

  test('falls back to the plain content when there is no highlight', () => {
    const segment = makeSegment({ textJa: { content: '食べたい', highlight: '' } });

    expect(buildSegmentMessage(segment, media)).toContain('**JP**: 食べたい');
  });

  test('wraps every link in <> so Discord does not unfurl a preview for each', () => {
    // Three links per reply, each with its own embed card, would bury the
    // sentence the reply exists to show.
    const message = buildSegmentMessage(makeSegment(), media);

    expect(message).not.toMatch(/\]\(https/);
    expect(message).toMatch(/\]\(<https/);
  });

  test('degrades to plain names when the media is unknown', () => {
    const message = buildSegmentMessage(makeSegment({ episode: 4 }), undefined);

    expect(message).toContain('Unknown');
    expect(message).toContain('Episode 4');
    // Nothing to link to, so nothing should pretend there is.
    expect(message).not.toContain('[Unknown](');
  });
});

describe('getMediaName', () => {
  test('prefers romaji, then english, then japanese', () => {
    expect(getMediaName({ nameRomaji: 'R', nameEn: 'E', nameJa: 'J' })).toBe('R');
    expect(getMediaName({ nameRomaji: null, nameEn: 'E', nameJa: 'J' })).toBe('E');
    expect(getMediaName({ nameRomaji: null, nameEn: null, nameJa: 'J' })).toBe('J');
  });

  test('treats an empty string as absent, not as a name', () => {
    expect(getMediaName({ nameRomaji: '', nameEn: 'E' })).toBe('E');
  });

  test('says Unknown rather than printing nothing', () => {
    expect(getMediaName(undefined)).toBe('Unknown');
    expect(getMediaName({})).toBe('Unknown');
  });
});

describe('formatTimestamp', () => {
  test('renders m:ss with a padded seconds field', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(5000)).toBe('0:05');
    expect(formatTimestamp(65000)).toBe('1:05');
    expect(formatTimestamp(600000)).toBe('10:00');
  });

  test('rounds down to the second the clip actually starts on', () => {
    expect(formatTimestamp(65999)).toBe('1:05');
  });

  test('counts past an hour in minutes rather than rolling over', () => {
    // Deliberate: these are timestamps inside one episode, so 61:01 is more
    // useful to scrub to than 1:01:01.
    expect(formatTimestamp(3661000)).toBe('61:01');
  });
});

describe('stripAllHtmlTags', () => {
  test('removes tags and keeps the text between them', () => {
    expect(stripAllHtmlTags('<em>食べ</em>たい')).toBe('食べたい');
    expect(stripAllHtmlTags('plain')).toBe('plain');
  });

  test('leaves a bare angle bracket that is not a tag', () => {
    expect(stripAllHtmlTags('5 < 6')).toBe('5 < 6');
  });
});
