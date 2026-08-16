import { describe, expect, it } from 'vitest';
import { createSegmentTaps } from './segmentTaps';

/**
 * The number that decides whether the word lookup should batch. Getting it wrong
 * is not visible in the product at all -- it is visible as a decision made on a
 * flattered rate months later, which is why it is tested rather than eyeballed.
 */
describe('createSegmentTaps', () => {
  const SENTENCE = '今日はいい天気ですね';
  const OTHER = '公園で犬と遊んだ';

  it('counts the first word in a sentence as one', () => {
    const taps = createSegmentTaps();

    expect(taps.record(SENTENCE, '天気')).toBe(1);
  });

  it('counts distinct words as they are opened', () => {
    const taps = createSegmentTaps();

    expect(taps.record(SENTENCE, '天気')).toBe(1);
    expect(taps.record(SENTENCE, 'いい')).toBe(2);
    expect(taps.record(SENTENCE, '今日')).toBe(3);
  });

  // A reader who checks a word, moves away and comes back has looked at one
  // word, and a batch would have fetched one word. Counting the reopen would
  // flatter exactly the case being measured.
  it('does not count reopening the same word twice', () => {
    const taps = createSegmentTaps();

    expect(taps.record(SENTENCE, '天気')).toBe(1);
    expect(taps.record(SENTENCE, 'いい')).toBe(2);
    expect(taps.record(SENTENCE, '天気')).toBe(2);
  });

  // The component is reused: a search replaces the results under it and hands
  // the same instance a different sentence. Carrying the count across would
  // report two sentences' taps as one.
  it('starts again when the sentence changes', () => {
    const taps = createSegmentTaps();

    taps.record(SENTENCE, '天気');
    taps.record(SENTENCE, 'いい');

    expect(taps.record(OTHER, '公園')).toBe(1);
  });

  // Returning to a sentence is a fresh reading of it, not a continuation: the
  // count is about one visit, because a batch would have been one fetch.
  it('does not remember a sentence it has left', () => {
    const taps = createSegmentTaps();

    taps.record(SENTENCE, '天気');
    taps.record(OTHER, '公園');

    expect(taps.record(SENTENCE, '天気')).toBe(1);
  });

  // A caller with no sentence to hand over (the tokens were rendered without a
  // result) still counts, rather than throwing or silently sharing one bucket
  // with every other such caller on the page.
  it('still counts when there is no sentence text', () => {
    const taps = createSegmentTaps();

    expect(taps.record('', '天気')).toBe(1);
    expect(taps.record('', 'いい')).toBe(2);
  });
});
