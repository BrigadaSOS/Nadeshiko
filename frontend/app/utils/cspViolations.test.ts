import { describe, expect, it } from 'vitest';
import {
  CSP_VIOLATION_LOG_LIMIT,
  createCspViolationLog,
  originOf,
  violationMatchesUrl,
  type CspViolation,
} from './cspViolations';

const violation = (blockedURI: string, at: number, effectiveDirective = 'connect-src'): CspViolation => ({
  blockedURI,
  effectiveDirective,
  at,
});

const ANKI = 'http://127.0.0.1:8765';

describe('originOf', () => {
  it('reduces a URL to its origin', () => {
    expect(originOf('http://127.0.0.1:8765/some/path?q=1')).toBe(ANKI);
  });

  it('returns null for the bare schemes a blocked URI can be', () => {
    // The browser reports these instead of a URL for inline and scheme sources,
    // and they must not be coerced into matching anything.
    for (const value of ['inline', 'data', 'blob', 'eval']) {
      expect(originOf(value)).toBeNull();
    }
  });
});

describe('violationMatchesUrl', () => {
  it('matches when the browser truncated the blocked URI to the origin', () => {
    // The case that actually happens cross-origin: we asked for a path, the
    // report came back without one.
    expect(violationMatchesUrl(violation(ANKI, 0), 'http://127.0.0.1:8765/')).toBe(true);
  });

  it('matches a full blocked URI against the address that produced it', () => {
    expect(violationMatchesUrl(violation('http://127.0.0.1:8765/x', 0), ANKI)).toBe(true);
  });

  it('does not match a different port on the same host', () => {
    // A reader running something else on 8766 must not have its refusal
    // attributed to Anki.
    expect(violationMatchesUrl(violation('http://127.0.0.1:8766', 0), ANKI)).toBe(false);
  });

  it('does not match a different host', () => {
    expect(violationMatchesUrl(violation('http://192.168.1.10:8765', 0), ANKI)).toBe(false);
  });

  it('does not treat loopback spellings as interchangeable', () => {
    // They are different origins to the browser, so the policy refuses them
    // separately and this must report them separately too.
    expect(violationMatchesUrl(violation('http://localhost:8765', 0), ANKI)).toBe(false);
  });

  it('is false rather than throwing when either side is unparseable', () => {
    expect(violationMatchesUrl(violation('inline', 0), ANKI)).toBe(false);
    expect(violationMatchesUrl(violation(ANKI, 0), 'not a url')).toBe(false);
  });
});

describe('createCspViolationLog', () => {
  it('reports a refusal recorded after the request started', () => {
    const log = createCspViolationLog();
    log.record(violation(ANKI, 1_000));
    expect(log.refusedSince(ANKI, 1_000)).toBe(true);
  });

  it('counts a refusal in the same millisecond the request started', () => {
    // A policy refusal needs no network, so this is the normal case and not
    // an edge one -- `>` instead of `>=` would miss almost every real refusal.
    const log = createCspViolationLog();
    log.record(violation(ANKI, 500));
    expect(log.refusedSince(ANKI, 500)).toBe(true);
  });

  it('ignores a refusal from before the request started', () => {
    // Without this an old refusal would explain every later failure, including
    // the ordinary Anki-is-closed one.
    const log = createCspViolationLog();
    log.record(violation(ANKI, 100));
    expect(log.refusedSince(ANKI, 500)).toBe(false);
  });

  it('ignores refusals of other origins', () => {
    const log = createCspViolationLog();
    log.record(violation('https://rdtds.net/siblings/find', 1_000));
    expect(log.refusedSince(ANKI, 0)).toBe(false);
  });

  it('answers false on an empty log', () => {
    expect(createCspViolationLog().refusedSince(ANKI, 0)).toBe(false);
  });

  it('keeps the newest entries when it overflows', () => {
    const log = createCspViolationLog(3);
    for (let i = 0; i < 10; i++) log.record(violation(`http://127.0.0.1:${8000 + i}`, i));

    expect(log.entries()).toHaveLength(3);
    // The most recent survived...
    expect(log.refusedSince('http://127.0.0.1:8009', 0)).toBe(true);
    // ...and the oldest fell off.
    expect(log.refusedSince('http://127.0.0.1:8000', 0)).toBe(false);
  });

  it('defaults to a bounded limit', () => {
    const log = createCspViolationLog();
    for (let i = 0; i < CSP_VIOLATION_LOG_LIMIT + 25; i++) log.record(violation(ANKI, i));
    expect(log.entries()).toHaveLength(CSP_VIOLATION_LOG_LIMIT);
  });
});
