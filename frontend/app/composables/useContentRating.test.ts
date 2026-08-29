import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

import { useContentRating } from './useContentRating';

/**
 * What a reader's content-rating preference means for the results they get.
 *
 * The default is BLUR rather than SHOW or HIDE, and that is the whole design:
 * the sentence is still there to be read, but nobody is shown explicit imagery
 * they did not ask for -- and nothing silently vanishes from a corpus they can
 * see the count of.
 *
 * SAFE and SUGGESTIVE are never restricted. Only QUESTIONABLE and EXPLICIT read
 * the preference, and they share one key, so a reader has a single switch rather
 * than a matrix.
 */
const user = reactive({
  isLoggedIn: true,
  preferences: {} as Record<string, unknown> | null,
});

vi.stubGlobal('userStore', () => user);

beforeEach(() => {
  user.isLoggedIn = true;
  user.preferences = {};
});

describe('the preference itself', () => {
  test('defaults to blurring, not to showing', () => {
    // A reader who has never opened the setting must not be shown explicit
    // imagery because of it.
    expect(useContentRating().preferences.value.nsfw).toBe('BLUR');
  });

  test('defaults for a reader with no preferences blob at all', () => {
    user.preferences = null;

    expect(useContentRating().preferences.value.nsfw).toBe('BLUR');
  });

  test('is whatever the reader chose', () => {
    user.preferences = { contentRatingPreferences: { nsfw: 'SHOW' } };

    expect(useContentRating().preferences.value.nsfw).toBe('SHOW');
  });
});

describe('which ratings the search asks for', () => {
  test('everything, while the reader is only blurring', () => {
    // Blurring is a display decision; the results still belong in the list, and
    // filtering them out here would make the counts disagree with the corpus.
    expect(useContentRating().contentRating.value).toEqual(['SAFE', 'SUGGESTIVE', 'QUESTIONABLE', 'EXPLICIT']);
  });

  test('everything, when the reader asked to see it', () => {
    user.preferences = { contentRatingPreferences: { nsfw: 'SHOW' } };

    expect(useContentRating().contentRating.value).toEqual(['SAFE', 'SUGGESTIVE', 'QUESTIONABLE', 'EXPLICIT']);
  });

  test('drops the restricted ones when the reader asked to hide them', () => {
    user.preferences = { contentRatingPreferences: { nsfw: 'HIDE' } };

    expect(useContentRating().contentRating.value).toEqual(['SAFE', 'SUGGESTIVE']);
  });

  test('never drops SAFE, whatever the preference says', () => {
    // Hiding it would empty the corpus for anyone who set it.
    user.preferences = { contentRatingPreferences: { nsfw: 'HIDE' } };

    expect(useContentRating().contentRating.value).toContain('SAFE');
  });

  test('never drops SUGGESTIVE either, which is not what the switch is about', () => {
    user.preferences = { contentRatingPreferences: { nsfw: 'HIDE' } };

    expect(useContentRating().contentRating.value).toContain('SUGGESTIVE');
  });
});

describe('what gets blurred', () => {
  test.each(['QUESTIONABLE', 'EXPLICIT'])('%s is blurred by default', (rating) => {
    expect(useContentRating().shouldBlur(rating)).toBe(true);
  });

  test.each(['SAFE', 'SUGGESTIVE'])('%s never is', (rating) => {
    expect(useContentRating().shouldBlur(rating)).toBe(false);
  });

  test('nothing is blurred once the reader asked to see it', () => {
    user.preferences = { contentRatingPreferences: { nsfw: 'SHOW' } };

    expect(useContentRating().shouldBlur('EXPLICIT')).toBe(false);
  });

  test('nothing is blurred when it is hidden instead, since it is not on screen', () => {
    // A blur over a result that was filtered out server-side would be a blur
    // over nothing.
    user.preferences = { contentRatingPreferences: { nsfw: 'HIDE' } };

    expect(useContentRating().shouldBlur('EXPLICIT')).toBe(false);
  });

  test('reads the rating case-insensitively, since payloads disagree', () => {
    expect(useContentRating().shouldBlur('explicit')).toBe(true);
    expect(useContentRating().shouldBlur('safe')).toBe(false);
  });

  test('a rating nobody has heard of is not blurred', () => {
    // A rating the backend adds before the frontend knows about it should not
    // blur every result on the page.
    expect(useContentRating().shouldBlur('SOMETHING_NEW')).toBe(false);
  });
});

describe('what counts as restricted', () => {
  test('SAFE does not', () => {
    expect(useContentRating().isRestricted('SAFE')).toBe(false);
  });

  test.each(['SUGGESTIVE', 'QUESTIONABLE', 'EXPLICIT'])('%s does', (rating) => {
    expect(useContentRating().isRestricted(rating)).toBe(true);
  });

  test('and it does not depend on the reader’s preference', () => {
    // This is a property of the content, not of who is looking; the preference
    // decides what to DO about it.
    user.preferences = { contentRatingPreferences: { nsfw: 'SHOW' } };

    expect(useContentRating().isRestricted('EXPLICIT')).toBe(true);
  });

  test('reads the rating case-insensitively too', () => {
    expect(useContentRating().isRestricted('safe')).toBe(false);
  });
});
