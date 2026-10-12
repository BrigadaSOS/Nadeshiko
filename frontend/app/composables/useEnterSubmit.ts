/**
 * Do not submit the Enter press that confirms an IME conversion. v-model withholds composed
 * text until compositionend, so that press can submit stale or empty input. See
 * https://github.com/BrigadaSOS/Nadeshiko/issues/399.
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
