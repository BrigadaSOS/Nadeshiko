import { describe, it, expect } from 'vitest';
import {
  LOGIN_CODE_ALPHABET,
  LOGIN_CODE_COOKIE,
  LOGIN_CODE_LENGTH,
  generateLoginCode,
  normalizeLoginCode,
  issueLoginCodeBinding,
  readLoginCodeBinding,
  readCookie,
} from '@app/services/auth/loginCode';

describe('generateLoginCode', () => {
  it('is six characters from the alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateLoginCode();
      expect(code).toHaveLength(LOGIN_CODE_LENGTH);
      expect([...code].every((char) => LOGIN_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });

  /** Use four characters because that is the code a reader transfers between screens. */
  it('never emits I, O, 0 or 1', () => {
    const sample = Array.from({ length: 400 }, () => generateLoginCode()).join('');

    expect(sample).not.toMatch(/[IO01]/);
  });

  it('does not return the same code twice in a row', () => {
    expect(generateLoginCode()).not.toBe(generateLoginCode());
  });
});

describe('normalizeLoginCode', () => {
  it.each([
    ['X5KDNZ', 'X5KDNZ'],
    ['x5kdnz', 'X5KDNZ'],
    ['X5KD-NZ', 'X5KDNZ'],
    ['x5k dnz', 'X5KDNZ'],
    ['  X5KDNZ  ', 'X5KDNZ'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeLoginCode(input)).toBe(expected);
  });

  /** Drop punctuation such as a password-manager space, but refuse wrong length: only length gives a definite
   * invalid input rather than an ambiguous correction. */
  it.each(['', 'X5KDN', 'X5KDNZQ', '------', null, undefined])('refuses %s', (input) => {
    expect(normalizeLoginCode(input)).toBeNull();
  });
});

describe('the browser binding', () => {
  it('round-trips the address it was issued for', () => {
    expect(readLoginCodeBinding(issueLoginCodeBinding('reader@example.com'))).toBe('reader@example.com');
  });

  it('normalizes the address, so case cannot cause a mismatch later', () => {
    expect(readLoginCodeBinding(issueLoginCodeBinding('  Reader@Example.COM '))).toBe('reader@example.com');
  });

  it('refuses a forged or corrupt claim', () => {
    expect(readLoginCodeBinding('not-a-binding')).toBeNull();
    expect(readLoginCodeBinding('')).toBeNull();
    expect(readLoginCodeBinding(null)).toBeNull();
  });

  /** Bind the code to the requesting browser; otherwise a later code could be spent by an unrelated browser. */
  it('refuses a claim older than the code it was issued with', () => {
    const sealed = issueLoginCodeBinding('reader@example.com');
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60 * 1000;

    try {
      expect(readLoginCodeBinding(sealed)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});

describe('readCookie', () => {
  it('finds the named cookie among others', () => {
    expect(readCookie('a=1; nd-login-code=abc.def; b=2', 'nd-login-code')).toBe('abc.def');
  });

  /** Splitting on every `=` truncates any value containing one, as base64 padding does. */
  it('splits on the first = only', () => {
    expect(readCookie('nd-login-code=YWJjZA==', 'nd-login-code')).toBe('YWJjZA==');
  });

  it('returns null when absent or when there is no header at all', () => {
    expect(readCookie('a=1', 'nd-login-code')).toBeNull();
    expect(readCookie(undefined, 'nd-login-code')).toBeNull();
  });

  it('does not match a cookie whose name merely ends with the one asked for', () => {
    expect(readCookie('other-nd-login-code=nope', 'nd-login-code')).toBeNull();
  });

  /** Malformed percent-encoding must become a 400, not a 500; the cookie-reading middleware has no catch around this
   * parser. */
  it('does not throw on a value that will not percent-decode', () => {
    const header = `${LOGIN_CODE_COOKIE}=%zz; other=1`;

    expect(() => readCookie(header, LOGIN_CODE_COOKIE)).not.toThrow();
    expect(readLoginCodeBinding(readCookie(header, LOGIN_CODE_COOKIE))).toBeNull();
  });
});
