/**
 * Enter does not mean "submit" while a Japanese IME is in the loop: the first
 * press confirms the conversion candidate, and only a later one means the
 * reader is actually done. Chrome and Safari on macOS both deliver that
 * confirming press to a plain `@keydown.enter` -- Firefox reports it as
 * `Process` instead, which is why the bug never reproduced there.
 *
 * On a `v-model` field it submits an *empty* value rather than a
 * half-converted one, because `v-model` deliberately withholds the composed
 * text until `compositionend`, so the bound ref still holds whatever the input
 * had before the reader started typing.
 *
 * See https://github.com/BrigadaSOS/Nadeshiko/issues/399.
 */

// Keyed by element rather than held per caller, so one set of listeners is
// safe on many inputs at once -- a `v-for` row, or a factory that hands out
// fresh closures on every render. The state has to outlive those closures.
const composing = new WeakSet<EventTarget>();
const justConfirmed = new WeakSet<EventTarget>();

export function useEnterSubmit(submit: () => void) {
  return {
    compositionstart: (event: CompositionEvent) => {
      if (event.target) composing.add(event.target);
    },
    compositionend: (event: CompositionEvent) => {
      const el = event.target;
      if (!el) return;

      composing.delete(el);
      // Engines disagree on whether the confirming Enter arrives before or
      // after `compositionend`. `isComposing` covers the first ordering; this
      // covers the second. It cannot swallow a deliberate Enter, because a
      // second press by a human always lands in a later task than this clear.
      justConfirmed.add(el);
      setTimeout(() => justConfirmed.delete(el), 0);
    },
    keydown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      // 229 is the legacy spelling of "this key went to the IME, not to you".
      if (event.isComposing || event.keyCode === 229) return;

      const el = event.target;
      if (el && (composing.has(el) || justConfirmed.has(el))) return;

      submit();
    },
  };
}
