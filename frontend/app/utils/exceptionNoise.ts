/**
 * Drops the `$exception` events that describe the browser, or the reader, rather
 * than a fault anybody can fix.
 *
 * This is the counterpart to the filtering the app already does at the throw
 * site -- `isUnactionablePlaybackError` in the player store, `reportEvent`
 * instead of `reportError` in the Anki store. Those only reach the failures the
 * app catches. posthog-js also installs its own `onerror` /
 * `onunhandledrejection`, and what those pick up never passes through any of our
 * catch blocks, so a rejection nobody attached a handler to arrives regardless
 * of what the store decided. This is the only place that sees both.
 *
 * The bar for adding a rule here is that the event is noise WHEREVER it came
 * from, because that is all this can tell: `before_send` sees the serialised
 * event, not the throw.
 */

interface ExceptionListEntry {
  type?: unknown;
  value?: unknown;
}

/**
 * `AbortError` and `NotAllowedError` both mean the user agent declined on the
 * reader's behalf -- a load abandoned at their request, an action that needed a
 * gesture it did not get. Neither has a fix in the app.
 *
 * Kept in step with `isUnactionablePlaybackError`, which drops the same two
 * names off `HTMLAudioElement.play()`. The names are matched here against
 * `DOMException` alone rather than any exception, so an app error that happens
 * to be *called* `AbortError` still reports.
 */
const UNACTIONABLE_DOM_EXCEPTIONS = ['AbortError', 'NotAllowedError'];

/**
 * A notice, not an error: the browser is saying it could not deliver every
 * `ResizeObserver` callback inside one animation frame and will deliver the rest
 * in the next. It arrives through `window.onerror` with no stack and no
 * `error`, so there is nothing to act on and nothing to act with, and no
 * observer in the app changes layout in its own callback.
 *
 * Both spellings are matched: browsers disagree, and the older
 * "loop limit exceeded" is still what Safari sends.
 */
const RESIZE_OBSERVER_NOTICES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

/**
 * Globals that only a browser extension's injected script ever touches.
 *
 * When one of these is missing the extension is talking to itself and losing the
 * argument, on a page that happens to be ours. There is nothing on our side to
 * fix and nothing on our side that caused it -- we cannot install the extension,
 * uninstall it, or change what it injects.
 *
 * Matched on the identifier rather than the message around it, because the
 * wording is the engine's and differs between them: Safari says
 * `window.migakuCoreApiReceive is not a function. (In '...', '...' is
 * undefined)`, V8 says `... is not a function`. The identifier is the part
 * neither invents.
 *
 * Kept to names that cannot collide with app code. `migakuCoreApiReceive` is
 * Migaku's, and Migaku is a Japanese-study extension whose readers overlap
 * almost exactly with ours -- 36 of the 108 exceptions in the first 10 hours
 * after 2.4.10 shipped were one reader with it installed.
 */
const EXTENSION_GLOBALS = ['migakuCoreApiReceive'];

/**
 * Whether this `$exception` should be dropped instead of sent.
 *
 * Deliberate reports are never dropped, whatever they say. `reportError` sets
 * `$exception_fingerprint` on everything it sends, so its presence marks an
 * event the app chose to file, and that choice belongs to the call site that
 * made it -- `player:audio-play-failed` deliberately reports the
 * `NotSupportedError` cases that this function would otherwise be one rule away
 * from swallowing. Only autocaptured events are candidates.
 */
export function isUnactionableException(properties: Record<string, unknown> | undefined): boolean {
  if (!properties) return false;
  if (properties.$exception_fingerprint) return false;

  const list = properties.$exception_list;
  if (!Array.isArray(list) || list.length === 0) return false;

  const first = list[0] as ExceptionListEntry | undefined;
  const type = typeof first?.type === 'string' ? first.type : '';
  const value = typeof first?.value === 'string' ? first.value : '';

  if (RESIZE_OBSERVER_NOTICES.some((notice) => value.includes(notice))) return true;

  if (EXTENSION_GLOBALS.some((name) => value.includes(name))) return true;

  // posthog-js serialises a DOMException with the class as `type` and
  // `${name}: ${message}` as `value`, so the name is a prefix of the value and
  // not a field of its own. Anchored at the start rather than searched for, so
  // an unrelated message that quotes one of these names does not match.
  if (type === 'DOMException') {
    return UNACTIONABLE_DOM_EXCEPTIONS.some((name) => value.startsWith(`${name}:`));
  }

  return false;
}
