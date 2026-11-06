import { describe, expect, test } from 'vitest';
import { episodeLabelKey, isAudiobook } from '~/utils/media';

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
