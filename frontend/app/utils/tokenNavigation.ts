/**
 * Use one sentence tab stop with arrow-key navigation instead of making every result token tabbable. Token
 * offsets provide stable keys; the component owns DOM focus and presentation.
 */

/**
 * Null leaves the key to the browser. Hold consumes a widget arrow without moving, preventing page scroll at
 * sentence boundaries.
 */
export type TokenKeyAction = { type: 'open' } | { type: 'move'; to: number } | { type: 'hold' } | null;

/**
 * Retain the current token if present, otherwise use the first navigable token so a rebuilt sentence stays in
 * the tab order.
 */
export function tabStop(keys: readonly number[], current: number | null): number | null {
  if (current !== null && keys.includes(current)) return current;
  return keys[0] ?? null;
}

/**
 * Both arrow axes traverse wrapped sentences. Stop rather than wrap at the ends; Home/End move explicitly to
 * a boundary.
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
