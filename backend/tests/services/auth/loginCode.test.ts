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

  /**
   * The four characters a person reads off one screen and mistypes into
   * another. Their absence is the entire reason for a custom alphabet.
   */
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

  /**
   * Punctuation is dropped rather than refused — somebody whose password
   * manager added a space has not made a mistake worth an error. Only the length
   * is a real refusal, because that is the one case where accepting it would
   * mean guessing at what they meant.
   */
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

  /**
   * The binding is what says "this browser asked". One that outlived the code it
   * was issued beside would let a browser spend a later code it never requested.
   */
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

  /**
   * A malformed percent-sequence is a 400 on the spend path, not a 500. The
   * middleware that reads this cookie has no try/catch, so a throw out of here
   * would surface as a server error on a request the flow already knows how to
   * refuse.
   */
  it('does not throw on a value that will not percent-decode', () => {
    const header = `${LOGIN_CODE_COOKIE}=%zz; other=1`;

    expect(() => readCookie(header, LOGIN_CODE_COOKIE)).not.toThrow();
    expect(readLoginCodeBinding(readCookie(header, LOGIN_CODE_COOKIE))).toBeNull();
  });
});
