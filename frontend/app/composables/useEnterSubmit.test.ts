import { describe, expect, it, vi } from 'vitest';
import { useEnterSubmit } from '~/composables/useEnterSubmit';

// The guard keys its state by element, so every test needs a stand-in for one.
const input = () => ({}) as unknown as EventTarget;

const keydown = (target: EventTarget, init: Partial<KeyboardEvent> = {}) =>
  ({ key: 'Enter', isComposing: false, keyCode: 13, target, ...init }) as unknown as KeyboardEvent;

const composition = (target: EventTarget) => ({ target }) as unknown as CompositionEvent;

describe('useEnterSubmit', () => {
  it('submits on an Enter typed without an IME', () => {
    const submit = vi.fn();

    useEnterSubmit(submit).keydown(keydown(input()));

    expect(submit).toHaveBeenCalledOnce();
  });

  it('leaves every other key alone', () => {
    const submit = vi.fn();

    useEnterSubmit(submit).keydown(keydown(input(), { key: 'a' }));

    expect(submit).not.toHaveBeenCalled();
  });

  // The macOS Japanese IME reports the conversion-confirming Enter this way in
  // Chrome and Safari, which is the whole of issue #399.
  it('ignores the Enter that confirms a conversion candidate', () => {
    const submit = vi.fn();

    useEnterSubmit(submit).keydown(keydown(input(), { isComposing: true }));

    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores the legacy 229 spelling of the same press', () => {
    const submit = vi.fn();

    useEnterSubmit(submit).keydown(keydown(input(), { keyCode: 229 }));

    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores an Enter dispatched between compositionstart and compositionend', () => {
    const submit = vi.fn();
    const el = input();
    const listeners = useEnterSubmit(submit);

    listeners.compositionstart(composition(el));
    listeners.keydown(keydown(el));

    expect(submit).not.toHaveBeenCalled();
  });

  // Some engines dispatch the confirming keydown *after* compositionend, by
  // which point `isComposing` has already gone false.
  it('ignores a confirming Enter that trails compositionend', () => {
    const submit = vi.fn();
    const el = input();
    const listeners = useEnterSubmit(submit);

    listeners.compositionstart(composition(el));
    listeners.compositionend(composition(el));
    listeners.keydown(keydown(el));

    expect(submit).not.toHaveBeenCalled();
  });

  it('submits on the reader’s next Enter once the conversion is settled', async () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const el = input();
    const listeners = useEnterSubmit(submit);

    listeners.compositionstart(composition(el));
    listeners.compositionend(composition(el));
    listeners.keydown(keydown(el));
    await vi.runAllTimersAsync();
    listeners.keydown(keydown(el));

    expect(submit).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  // Two rows of a `v-for` share one set of listeners; composing in one must not
  // silence Enter in the other.
  it('keeps composition state separate per input', () => {
    const submit = vi.fn();
    const composed = input();
    const other = input();
    const listeners = useEnterSubmit(submit);

    listeners.compositionstart(composition(composed));
    listeners.keydown(keydown(other));

    expect(submit).toHaveBeenCalledOnce();
  });

  // The closures are recreated on every render when a template calls the
  // composable as a factory; the guard has to survive that.
  it('holds its guard across freshly created listeners for the same input', () => {
    const submit = vi.fn();
    const el = input();

    useEnterSubmit(submit).compositionstart(composition(el));
    useEnterSubmit(submit).keydown(keydown(el));

    expect(submit).not.toHaveBeenCalled();
  });
});
