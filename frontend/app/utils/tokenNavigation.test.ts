import { describe, expect, it } from 'vitest';
import { tabStop, tokenKeyAction } from './tokenNavigation';

// A sentence's navigable words, by token offset. The gaps are the punctuation
// and whitespace the component leaves out: 顔[0] と[3] ...[6,7,8] 名前[9].
const SENTENCE = [0, 3, 9];

describe('tabStop', () => {
  it('is the first word until the reader has moved', () => {
    expect(tabStop(SENTENCE, null)).toBe(0);
  });

  it('follows the reader once they have', () => {
    expect(tabStop(SENTENCE, 9)).toBe(9);
  });

  it('falls back when the sentence changed under them', () => {
    // A search replaced the results while they were part-way along, and the
    // token they were on is gone. Keeping it would leave the sentence with no
    // tabbable word at all, which drops it out of the tab order.
    expect(tabStop(SENTENCE, 4)).toBe(0);
  });

  it('is nothing for a sentence with no word worth opening', () => {
    expect(tabStop([], null)).toBeNull();
    expect(tabStop([], 3)).toBeNull();
  });
});

describe('tokenKeyAction', () => {
  it('opens the card on the keys a button answers to', () => {
    expect(tokenKeyAction('Enter', SENTENCE, 0)).toEqual({ type: 'open' });
    expect(tokenKeyAction(' ', SENTENCE, 0)).toEqual({ type: 'open' });
  });

  it('steps over the punctuation between words', () => {
    // と is at 3 and 名前 at 9, with three punctuation tokens in between that
    // never entered the list. One press crosses all of them.
    expect(tokenKeyAction('ArrowRight', SENTENCE, 3)).toEqual({ type: 'move', to: 9 });
    expect(tokenKeyAction('ArrowLeft', SENTENCE, 9)).toEqual({ type: 'move', to: 3 });
  });

  it('treats both axes as the same walk, because a sentence wraps lines', () => {
    expect(tokenKeyAction('ArrowDown', SENTENCE, 0)).toEqual({ type: 'move', to: 3 });
    expect(tokenKeyAction('ArrowUp', SENTENCE, 3)).toEqual({ type: 'move', to: 0 });
  });

  it('stops at the ends rather than wrapping round', () => {
    // Still ours -- 'hold' keeps the browser from scrolling the page -- but the
    // reader keeps their place instead of being teleported to the other end.
    expect(tokenKeyAction('ArrowLeft', SENTENCE, 0)).toEqual({ type: 'hold' });
    expect(tokenKeyAction('ArrowRight', SENTENCE, 9)).toEqual({ type: 'hold' });
  });

  it('jumps to either end on purpose', () => {
    expect(tokenKeyAction('Home', SENTENCE, 9)).toEqual({ type: 'move', to: 0 });
    expect(tokenKeyAction('End', SENTENCE, 0)).toEqual({ type: 'move', to: 9 });
    expect(tokenKeyAction('Home', [], 0)).toEqual({ type: 'hold' });
  });

  it('hands back every key that is not the widget own', () => {
    // Tab must still tab out of the sentence, and typing must still reach the
    // search box a shortcut might focus.
    for (const key of ['Tab', 'a', 'Escape', 'PageDown', 'F5']) {
      expect(tokenKeyAction(key, SENTENCE, 0)).toBeNull();
    }
  });

  it('hands back an arrow from a token the sentence no longer has', () => {
    // Claiming it and moving nowhere would swallow the reader's key press for a
    // sentence that has been rebuilt beneath them.
    expect(tokenKeyAction('ArrowRight', SENTENCE, 4)).toBeNull();
  });
});
