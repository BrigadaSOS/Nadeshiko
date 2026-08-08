/**
 * Walking a sentence from the keyboard.
 *
 * A sentence of tokens is a composite widget, not a run of links: making every
 * word a tab stop would be the obvious way to reach them and a bad one, because
 * a page of results is thousands of words and a reader tabbing to the footer
 * would pay for every one. So the sentence takes ONE tab stop and the arrow keys
 * move within it -- the roving-tabindex pattern.
 *
 * The decisions live here rather than in the component for the same reason
 * `cardPlacement` does: they are the part that can quietly go wrong (a run that
 * skips a word, an edge that wraps when it should stop) and the part worth
 * testing on its own. The component keeps the DOM half -- moving focus, painting
 * the ring -- which is all it should have.
 *
 * Keys are token byte offsets: unique within a sentence, stable across the
 * re-renders that rebuild the token objects, and already the `v-for` key.
 */

/**
 * What a key press on a token means.
 *
 * `null` is "not ours" -- the component must leave the event alone so the
 * browser still gets Tab, typing, and shortcuts. `hold` is ours but goes
 * nowhere: an arrow at the end of a sentence is still the widget's key, and
 * letting it fall through would scroll the page out from under a reader who
 * only meant to move one word.
 */
export type TokenKeyAction = { type: 'open' } | { type: 'move'; to: number } | { type: 'hold' } | null;

/**
 * Which token holds the sentence's tab stop.
 *
 * The reader's last position when they have one and it still exists, and
 * otherwise the first word. Never null for a sentence with any navigable word,
 * which is the point: a sentence whose every token was `tabindex="-1"` would
 * drop out of the tab order altogether and become unreachable again.
 *
 * `current` can name a token that has gone -- the tokens are rebuilt whenever
 * the segment list re-renders, and a search can replace the sentence under a
 * reader who had walked into the middle of it.
 */
export function tabStop(keys: readonly number[], current: number | null): number | null {
  if (current !== null && keys.includes(current)) return current;
  return keys[0] ?? null;
}

/**
 * The token a key press moves to, or that it opens.
 *
 * Both axes move, because a sentence wraps over several lines: Down is as
 * natural a "next word" as Right to someone looking at the second line of one.
 *
 * The ends do not wrap. Arrowing off the last word of a sentence stays put
 * rather than jumping to the first: a reader who has walked to the end has
 * finished, and silently teleporting them back to the start reads as the widget
 * losing their place. Home and End are how you get to an end on purpose.
 */
export function tokenKeyAction(key: string, keys: readonly number[], from: number): TokenKeyAction {
  switch (key) {
    // Enter and Space are what a button answers to, and each token is one.
    case 'Enter':
    case ' ':
      return { type: 'open' };
    case 'ArrowRight':
    case 'ArrowDown':
      return step(keys, from, 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return step(keys, from, -1);
    case 'Home':
      return moveTo(keys[0]);
    case 'End':
      return moveTo(keys.at(-1));
    default:
      return null;
  }
}

function step(keys: readonly number[], from: number, delta: number): TokenKeyAction {
  const index = keys.indexOf(from);
  // A token that is not in the list at all: the sentence changed under the
  // reader. Claiming the event and moving nowhere would swallow their arrow key,
  // so hand it back.
  if (index === -1) return null;
  return moveTo(keys[index + delta]);
}

function moveTo(to: number | undefined): TokenKeyAction {
  return to === undefined ? { type: 'hold' } : { type: 'move', to };
}
