import { describe, expect, it } from 'vitest';
import { isUnactionableException } from './exceptionNoise';

/** The shape posthog-js puts on the event, narrowed to what the filter reads. */
function event(type: string, value: string, extra: Record<string, unknown> = {}) {
  return { $exception_list: [{ type, value }], ...extra };
}

describe('isUnactionableException', () => {
  it('drops the ResizeObserver notice in both spellings', () => {
    expect(
      isUnactionableException(event('Error', 'ResizeObserver loop completed with undelivered notifications.')),
    ).toBe(true);
    expect(isUnactionableException(event('Error', 'ResizeObserver loop limit exceeded'))).toBe(true);
  });

  it('drops the play() rejections the reader causes', () => {
    // The two seen in production: an element torn out mid-play, and an autoplay
    // that was not close enough to a gesture.
    expect(
      isUnactionableException(
        event(
          'DOMException',
          'AbortError: The play() request was interrupted because the media was removed from the document.',
        ),
      ),
    ).toBe(true);
    expect(
      isUnactionableException(
        event('DOMException', 'NotAllowedError: play() can only be initiated by a user gesture.'),
      ),
    ).toBe(true);
  });

  it('keeps a clip that genuinely will not decode', () => {
    // The case the whole player fingerprint exists to surface. It is a
    // DOMException too, so only the name separates it from the ones above.
    expect(
      isUnactionableException(
        event('DOMException', 'NotSupportedError: Failed to load because no supported source was found.'),
      ),
    ).toBe(false);
  });

  it('keeps anything the app reported on purpose', () => {
    // `reportError` stamps every event it sends. Dropping one would silently
    // undo a decision made at the call site.
    expect(
      isUnactionableException(
        event('DOMException', 'AbortError: The operation was aborted.', {
          $exception_fingerprint: 'player:audio-play-failed',
        }),
      ),
    ).toBe(false);
  });

  it('does not match a name that is merely quoted in the message', () => {
    expect(isUnactionableException(event('DOMException', 'InvalidStateError: expected AbortError: here'))).toBe(false);
  });

  it('only claims DOMException names for DOMExceptions', () => {
    expect(isUnactionableException(event('AbortError', 'AbortError: something the app threw'))).toBe(false);
  });

  it("drops an extension's calls into its own missing globals, in either engine's wording", () => {
    // Both seen in production from the same reader, one second apart. Safari
    // quotes the whole call back at you; V8 does not.
    expect(
      isUnactionableException(
        event(
          'TypeError',
          "window.migakuCoreApiReceive is not a function. (In 'window.migakuCoreApiReceive('{\"id\":\"mYR0\"}')', 'window.migakuCoreApiReceive' is undefined)",
        ),
      ),
    ).toBe(true);
    expect(isUnactionableException(event('TypeError', 'window.migakuCoreApiReceive is not a function'))).toBe(true);
  });

  it('still files a deliberate report that happens to mention the extension', () => {
    expect(
      isUnactionableException(
        event('TypeError', 'window.migakuCoreApiReceive is not a function', {
          $exception_fingerprint: 'anki:export-failed',
        }),
      ),
    ).toBe(false);
  });

  it('passes through events it cannot read', () => {
    expect(isUnactionableException(undefined)).toBe(false);
    expect(isUnactionableException({})).toBe(false);
    expect(isUnactionableException({ $exception_list: [] })).toBe(false);
  });
});
