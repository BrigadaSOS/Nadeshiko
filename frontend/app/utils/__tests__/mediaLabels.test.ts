import { describe, expect, test } from 'vitest';
import { episodeLabel, episodeLabelKey, isAudiobook } from '~/utils/media';

describe('episodeLabelKey', () => {
  test('an audiobook is split into chapters', () => {
    expect(isAudiobook({ category: 'AUDIOBOOK' })).toBe(true);
    expect(episodeLabelKey({ category: 'AUDIOBOOK' })).toBe('searchpage.main.labels.chapter');
  });

  test('everything else keeps episodes, including a missing media', () => {
    expect(episodeLabelKey({ category: 'ANIME' })).toBe('searchpage.main.labels.episode');
    expect(episodeLabelKey(null)).toBe('searchpage.main.labels.episode');
  });
});

describe('episodeLabel', () => {
  const t = (key: string, values?: Record<string, unknown>) => `${key}:${values?.number}`;

  test('an audiobook chapter shows its number and its title', () => {
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 4, '(3)つねに由比ヶ浜結衣はきょろきょろしている。')).toBe(
      'searchpage.main.labels.chapter:4 · (3)つねに由比ヶ浜結衣はきょろきょろしている。',
    );
  });

  test('a chapter without a title, or a blank one, shows just the number', () => {
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 4, null)).toBe('searchpage.main.labels.chapter:4');
    expect(episodeLabel(t, { category: 'AUDIOBOOK' }, 4, '  ')).toBe('searchpage.main.labels.chapter:4');
  });

  test('anime keeps "Episode N" even when its episode has a title', () => {
    expect(episodeLabel(t, { category: 'ANIME' }, 1, 'Pilot')).toBe('searchpage.main.labels.episode:1');
  });
});
