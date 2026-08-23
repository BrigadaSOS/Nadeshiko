import { describe, expect, it } from 'vitest';
import {
  SPANISH_NUDGE_DISMISSED_KEY,
  dismissSpanishNudge,
  isSpanishNudgeDismissed,
  shouldOfferSpanish,
  speaksSpanish,
} from './spanishLocaleNudge';

describe('speaksSpanish', () => {
  it('matches every Spanish region tag', () => {
    for (const tag of ['es', 'es-ES', 'es-MX', 'es-419', 'ES-mx']) {
      expect(speaksSpanish([tag])).toBe(true);
    }
  });

  it('does not match Estonian, which a prefix test would have taken', () => {
    expect(speaksSpanish(['est'])).toBe(false);
    expect(speaksSpanish(['et'])).toBe(false);
  });

  it('finds Spanish anywhere in the preference list', () => {
    expect(speaksSpanish(['en-GB', 'fr', 'es-AR'])).toBe(true);
  });

  it('is false for no list at all', () => {
    expect(speaksSpanish(undefined)).toBe(false);
    expect(speaksSpanish(null)).toBe(false);
    expect(speaksSpanish([])).toBe(false);
  });
});

describe('shouldOfferSpanish', () => {
  const base = { locale: 'en', languages: ['es-ES'], dismissed: false };

  it('offers to a Spanish speaker on an English page', () => {
    expect(shouldOfferSpanish(base)).toBe(true);
  });

  it('never offers twice', () => {
    expect(shouldOfferSpanish({ ...base, dismissed: true })).toBe(false);
  });

  it('stays out of the way on the Spanish and Japanese pages', () => {
    expect(shouldOfferSpanish({ ...base, locale: 'es' })).toBe(false);
    expect(shouldOfferSpanish({ ...base, locale: 'ja' })).toBe(false);
  });

  it('does not offer to a reader with no Spanish', () => {
    expect(shouldOfferSpanish({ ...base, languages: ['en-US', 'ja'] })).toBe(false);
  });
});

describe('dismissal storage', () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it('round-trips a dismissal', () => {
    const s = memoryStorage();
    expect(isSpanishNudgeDismissed(s)).toBe(false);
    dismissSpanishNudge(s);
    expect(isSpanishNudgeDismissed(s)).toBe(true);
    expect(s.getItem(SPANISH_NUDGE_DISMISSED_KEY)).toBe('1');
  });

  it('survives a browser that throws on storage access', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(isSpanishNudgeDismissed(throwing)).toBe(false);
    expect(() => dismissSpanishNudge(throwing)).not.toThrow();
  });

  it('treats a missing storage object as not dismissed', () => {
    expect(isSpanishNudgeDismissed(undefined)).toBe(false);
    expect(() => dismissSpanishNudge(undefined)).not.toThrow();
  });
});
