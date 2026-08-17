import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, secretEquals, SecretBoxError } from '@lib/secretBox';

const SECRET = 'a-test-secret-that-is-long-enough';

describe('secretBox', () => {
  it('round-trips a value', () => {
    expect(decryptSecret(encryptSecret('shr_live_token', SECRET), SECRET)).toBe('shr_live_token');
  });

  // The nonce is random per encryption, so identical plaintexts do not produce
  // identical ciphertexts. Worth pinning: it is what stops the table from
  // revealing which two rows hold the same token, and it is also why nothing may
  // compare ciphertexts for equality.
  it('encrypts the same value differently every time', () => {
    expect(encryptSecret('same', SECRET)).not.toBe(encryptSecret('same', SECRET));
  });

  it('refuses a value encrypted under a different secret', () => {
    const sealed = encryptSecret('shr_live_token', SECRET);

    expect(() => decryptSecret(sealed, 'a-different-secret-entirely')).toThrow(SecretBoxError);
  });

  // Authenticated encryption: an edited ciphertext fails to open rather than
  // decrypting to something an attacker chose.
  it('refuses a tampered payload', () => {
    const [version, nonce, tag, ciphertext] = encryptSecret('shr_live_token', SECRET).split('.');
    const flipped = `${ciphertext.slice(0, -4)}AAAA`;

    expect(() => decryptSecret([version, nonce, tag, flipped].join('.'), SECRET)).toThrow(SecretBoxError);
  });

  it('refuses a payload from an unknown format version', () => {
    const sealed = encryptSecret('shr_live_token', SECRET).replace(/^v1\./, 'v2.');

    expect(() => decryptSecret(sealed, SECRET)).toThrow(/Unknown secret format/);
  });

  it('refuses a malformed payload rather than throwing something shapeless', () => {
    expect(() => decryptSecret('v1.only-one-part', SECRET)).toThrow(/Malformed secret/);
  });

  // Unset config is the default, and it must fail loudly rather than encrypting
  // under an empty key.
  it('refuses to work with no secret configured', () => {
    expect(() => encryptSecret('x', '')).toThrow(SecretBoxError);
    expect(() => decryptSecret('v1.a.b.c', '')).toThrow(SecretBoxError);
  });

  // A secret of any length has to become a 32-byte key, so nothing here may
  // depend on the input already being the right size.
  it('takes a secret of any length', () => {
    for (const secret of ['x', 'a'.repeat(200)]) {
      expect(decryptSecret(encryptSecret('token', secret), secret)).toBe('token');
    }
  });

  describe('secretEquals', () => {
    it('matches equal strings and rejects everything else', () => {
      expect(secretEquals('abc', 'abc')).toBe(true);
      expect(secretEquals('abc', 'abd')).toBe(false);
      expect(secretEquals('abc', 'abcd')).toBe(false);
      expect(secretEquals('', '')).toBe(true);
    });
  });
});
