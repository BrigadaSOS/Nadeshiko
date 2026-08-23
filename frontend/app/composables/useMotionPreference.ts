import { MOTION_COOKIE } from '#shared/utils/preferenceCookies';
import { useCookiePreference } from '~/composables/useCookiePreference';

/**
 * How much the interface is allowed to move.
 *
 *   system   follow the OS accessibility setting (the default)
 *   reduced  keep the cheap colour and opacity fades, drop anything that
 *            slides, resizes or re-blurs
 *   none     nothing animates
 *
 * A cookie rather than a stored user preference, for three reasons: a
 * signed-out reader gets to turn motion down too, the value is readable on the
 * server so `<html data-motion>` is correct in the first byte of HTML rather
 * than after hydration -- which is the difference between the setting applying
 * and the reader watching one last animation before it does -- and it needs no
 * round trip to the backend to take effect.
 *
 * The CSS half lives in `assets/css/tailwind.css` under MOTION TIERS.
 */
export const MOTION_LEVELS = ['system', 'reduced', 'none'] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];

export const DEFAULT_MOTION_LEVEL: MotionLevel = 'system';

// Imported rather than spelled out: a bare string here is exactly how this
// cookie stayed out of RENDER_FORKING_PREFERENCE_COOKIES, and out of every cache
// bypass that reads it, for its whole life. See that file.
const COOKIE_NAME = MOTION_COOKIE;

const isMotionLevel = (value: string | null): value is MotionLevel =>
  !!value && (MOTION_LEVELS as readonly string[]).includes(value);

export function useMotionPreference() {
  const { state, set } = useCookiePreference<MotionLevel>(COOKIE_NAME, 'motion-preference', {
    parse: (raw) => (isMotionLevel(raw) ? raw : DEFAULT_MOTION_LEVEL),
    // The default is the absence of a choice, so it clears rather than writes.
    serialize: (value) => (value === DEFAULT_MOTION_LEVEL ? null : value),
  });

  /**
   * What the tiers resolve to right now, with `system` answered.
   *
   * `system` is deliberately left unresolved in the attribute: the server
   * cannot read an OS setting, and resolving it there would make the HTML
   * differ per reader for something the CSS can answer on its own.
   */
  const level = computed<Exclude<MotionLevel, 'system'> | 'full'>(() => {
    if (state.value !== 'system') return state.value;
    if (import.meta.server || typeof window.matchMedia !== 'function') return 'full';
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'full';
  });

  /** True for both reduced tiers: the question most callers actually have. */
  const prefersReducedMotion = () => level.value !== 'full';

  /**
   * The one thing the CSS tiers cannot reach. `scroll-behavior: auto` loses to
   * an explicit `behavior` passed to `scrollIntoView`, so a smooth scroll asked
   * for in JS keeps animating however the tiers are set unless it asks here.
   */
  const scrollBehavior = (preferred: ScrollBehavior = 'smooth'): ScrollBehavior =>
    prefersReducedMotion() ? 'instant' : preferred;

  return { preference: state, setPreference: set, level, prefersReducedMotion, scrollBehavior };
}
