import { describe, it, expect, beforeEach } from 'vitest';
import {
  BURST_DISTINCT_LINKS,
  BURST_WINDOW_MS,
  EMAIL_LINK_PATH,
  LINK_BURST_CACHE,
  classifyHit,
  issueReturnToken,
  readReturnToken,
  resolveDestination,
  returnUrl,
  withAnalyticsSuppressed,
  type ReturnIntent,
} from '@app/services/email/returnLink';
import { Cache } from '@lib/cache';
import { config } from '@config/config';

const intent: ReturnIntent = { userId: 42, kind: 'dormant-30', campaign: 'dormant-30-2026-08' };

describe('the token in a lifecycle email link', () => {
  it('round-trips the account, the kind and the run', () => {
    expect(readReturnToken(issueReturnToken(intent))).toEqual(intent);
  });

  /**
   * The whole point of sealing it. Without authentication the account id is a
   * number in a public query string and anybody could file their own click
   * against somebody else's send -- or read one off a forwarded email and edit
   * it into a token for a neighbouring id.
   */
  it('refuses a token somebody has edited', () => {
    const token = issueReturnToken(intent);
    const tampered = `${token.slice(0, -4)}${token.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;

    expect(readReturnToken(tampered)).toBeNull();
  });

  /** Every shape a mail client, a scanner or a forgery can produce. */
  it.each([undefined, null, '', 'not-a-token', 'v2.deadbeef.aa.bb.cc', 42])('answers null for %p', (token) => {
    expect(readReturnToken(token)).toBeNull();
  });

  /**
   * One token per MESSAGE, not per link -- which is what lets `classifyHit` see
   * a scanner walking every link in one email. The ciphertext differs each call
   * (random nonce), so the burst cannot be keyed on the token string.
   */
  it('seals to a different string every time', () => {
    expect(issueReturnToken(intent)).not.toBe(issueReturnToken(intent));
  });
});

describe('where a click is allowed to land', () => {
  it('tags the destination it hands back, so web analytics still sees the campaign', () => {
    const resolved = resolveDestination('/media/frieren', 'dormant-30-2026-08', 'title-1');

    expect(resolved).toContain('/media/frieren');
    expect(resolved).toContain('utm_campaign=dormant-30-2026-08');
    expect(resolved).toContain('utm_content=title-1');
    expect(resolved).toContain('utm_medium=email');
  });

  it('keeps a query string the path already carried', () => {
    expect(resolveDestination('/search/x?sort=new', 'c', 'cta')).toContain('sort=new');
  });

  /**
   * THE ONE BUG THIS FILE COULD PLAUSIBLY SHIP. The path is a query parameter on
   * a public URL, so without these checks we are a nadeshiko.co address that
   * forwards anywhere a phisher likes -- which is precisely the primitive they
   * want from us.
   */
  it.each([
    ['//evil.example', 'protocol-relative, parses as another host'],
    ['https://evil.example/x', 'an absolute URL'],
    ['/\\evil.example', 'a backslash some clients read as a slash'],
    ['evil.example', 'no leading slash at all'],
    ['', 'nothing'],
  ])('refuses %s (%s)', (to) => {
    expect(resolveDestination(to, 'c', 'cta')).toBeNull();
  });

  it('refuses a destination that is not a string', () => {
    expect(resolveDestination(undefined, 'c', 'cta')).toBeNull();
  });

  it('points the wrapped link at the redirect rather than the destination', () => {
    const url = returnUrl({ ...intent, path: '/media/frieren', content: 'title-1' });

    expect(url.startsWith(`${config.BASE_URL}${EMAIL_LINK_PATH}?`)).toBe(true);
    expect(url).toContain('to=%2Fmedia%2Ffrieren');
    expect(url).toContain('c=title-1');

    // The account is sealed, never spelled out. Asserted over the readable
    // surface only -- everything but `t`. `t` is ciphertext, so a chance '42'
    // inside its base64 is not a leak, and asserting over the whole URL failed
    // on 2.33% of runs (measured over 200k tokens): roughly one full backend
    // suite in forty, for a reason that looks nothing like randomness.
    const parsed = new URL(url);
    const sealed = parsed.searchParams.get('t');
    expect(sealed).toBeTruthy();
    parsed.searchParams.delete('t');
    expect(`${parsed.pathname}?${parsed.searchParams}`).not.toContain('42');
  });

  it('marks a destination so the frontend skips analytics', () => {
    expect(withAnalyticsSuppressed('https://nadeshiko.co/x?a=1')).toContain('nb=1');
  });
});

describe('telling a reader apart from a mail scanner', () => {
  beforeEach(() => {
    Cache.invalidate(LINK_BURST_CACHE);
  });

  const hit = (content: string, at: number) => classifyHit(intent, content, false, at);

  it('counts a first click as a person', () => {
    expect(hit('cta', 1_000)).toBe('human');
  });

  it('takes a client at its word when it says it is prefetching', () => {
    expect(classifyHit(intent, 'cta', true, 1_000)).toBe('prefetch');
  });

  /**
   * Two covers middle-clicked into tabs is ordinary reader behaviour and has to
   * survive; the scanner we caught fetched nine distinct links in twelve
   * seconds. Three inside fifteen is above the first and well below the second.
   */
  it('lets a reader open two covers in quick succession', () => {
    expect(hit('title-1', 1_000)).toBe('human');
    expect(hit('title-2', 3_000)).toBe('human');
  });

  it('stops believing a message whose links are being walked', () => {
    for (let i = 0; i < BURST_DISTINCT_LINKS - 1; i++) {
      expect(hit(`title-${i}`, 1_000 + i * 100)).toBe('human');
    }

    expect(hit('title-9', 1_500)).toBe('fan-out');
  });

  /** The same cover twice is a person clicking twice, not a new click. */
  it('does not count the same link again', () => {
    expect(hit('cta', 1_000)).toBe('human');
    expect(hit('cta', 4_000)).toBe('repeat');
  });

  /**
   * The window runs from the FIRST hit and is never extended, so a reader
   * returning to the message every few seconds cannot have their third
   * unhurried click filed as a machine.
   */
  it('starts a fresh window once the old one has run out', () => {
    hit('title-1', 1_000);
    hit('title-2', 2_000);

    expect(hit('title-3', 1_000 + BURST_WINDOW_MS + 1)).toBe('human');
  });

  /** Two recipients reading at once are not one scanner. */
  it('keeps one recipient out of another recipient burst', () => {
    const other: ReturnIntent = { ...intent, userId: 43 };

    expect(classifyHit(intent, 'title-1', false, 1_000)).toBe('human');
    expect(classifyHit(intent, 'title-2', false, 1_100)).toBe('human');
    expect(classifyHit(other, 'title-3', false, 1_200)).toBe('human');
  });
});
