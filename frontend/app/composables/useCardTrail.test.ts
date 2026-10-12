import { describe, test, expect, vi } from 'vitest';
import { useCardTrail, type CardLocation } from './useCardTrail';

/**
 * An empty trail returns to the original token; new navigation discards forward history. Parts
 * restore access to words hidden inside merged expressions.
 */
const origin: CardLocation = { lemma: '男を知る', surface: '男を知っている', reading: '', pos: '' };
const part = (lemma: string) => ({ lemma, text: lemma, reading: '' });

function trail() {
  const loaded: string[] = [];
  const load = vi.fn(async (location: CardLocation) => {
    loaded.push(location.lemma);
  });
  return { loaded, load, ...useCardTrail(load, () => origin) };
}

describe('where the card is standing', () => {
  test('starts on the word it opened on, with nowhere to go', () => {
    const { canGoBack, canGoForward, currentLocation } = trail();

    expect(canGoBack.value).toBe(false);
    expect(canGoForward.value).toBe(false);
    expect(currentLocation()).toEqual(origin);
  });

  test('walking into a part loads it and offers the way back', async () => {
    const t = trail();

    await t.showPart(part('男'));

    expect(t.loaded).toEqual(['男']);
    expect(t.canGoBack.value).toBe(true);
    expect(t.currentLocation()?.lemma).toBe('男');
  });
});

describe('back and forward', () => {
  test('back from one step in lands on the origin, not on nothing', async () => {
    const t = trail();
    await t.showPart(part('男'));

    await t.goBack();

    // The origin was never pushed, so this is the only thing that could have
    // produced it -- which is the point of `origin()`.
    expect(t.loaded).toEqual(['男', '男を知る']);
    expect(t.canGoBack.value).toBe(false);
    expect(t.canGoForward.value).toBe(true);
  });

  test('forward returns to the step just left', async () => {
    const t = trail();
    await t.showPart(part('男'));
    await t.goBack();

    await t.goForward();

    expect(t.currentLocation()?.lemma).toBe('男');
    expect(t.canGoForward.value).toBe(false);
  });

  test('walking somewhere new throws the forward history away', async () => {
    const t = trail();
    await t.showPart(part('男'));
    await t.goBack();
    expect(t.canGoForward.value).toBe(true);

    await t.showPart(part('知る'));

    expect(t.canGoForward.value).toBe(false);
  });

  test('neither control does anything at its own end', async () => {
    const t = trail();

    await t.goBack();
    await t.goForward();

    expect(t.load).not.toHaveBeenCalled();
  });
});

describe('clearing', () => {
  test('leaves the card back on the word it opened on', async () => {
    const t = trail();
    await t.showPart(part('男'));
    await t.goBack();

    t.clearTrail();

    expect(t.canGoBack.value).toBe(false);
    expect(t.canGoForward.value).toBe(false);
    expect(t.currentLocation()).toEqual(origin);
  });
});
