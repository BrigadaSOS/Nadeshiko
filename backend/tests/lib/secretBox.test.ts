import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, secretEquals, SecretBoxError } from '@lib/secretBox';

const SECRET = 'a-test-secret-that-is-long-enough';
const CTX = { purpose: 'test.purpose' };

describe('secretBox', () => {
  it('round-trips a value', () => {
    expect(decryptSecret(encryptSecret('shra_live_token', SECRET, CTX), SECRET, CTX)).toBe('shra_live_token');
  });

  // Random nonces ensure identical plaintexts encrypt differently.
  it('encrypts the same value differently every time', () => {
    expect(encryptSecret('same', SECRET, CTX)).not.toBe(encryptSecret('same', SECRET, CTX));
  });

  it('refuses a value encrypted under a different secret', () => {
    const sealed = encryptSecret('shra_live_token', SECRET, CTX);

    expect(() => decryptSecret(sealed, 'a-different-secret-entirely', CTX)).toThrow(SecretBoxError);
  });

  // Authenticated encryption: an edited ciphertext fails to open rather than
  // decrypting to something an attacker chose.
  it('refuses a tampered payload', () => {
    const [version, keyId, nonce, tag, ciphertext] = encryptSecret('shra_live_token', SECRET, CTX).split('.');
    const flipped = `${ciphertext.slice(0, -4)}AAAA`;

    expect(() => decryptSecret([version, keyId, nonce, tag, flipped].join('.'), SECRET, CTX)).toThrow(SecretBoxError);
  });

  it('refuses a payload from an unknown format version', () => {
    const sealed = encryptSecret('shra_live_token', SECRET, CTX).replace(/^v2\./, 'v9.');

    expect(() => decryptSecret(sealed, SECRET, CTX)).toThrow(/Unknown secret format/);
  });

  it('refuses a malformed payload rather than throwing something shapeless', () => {
    expect(() => decryptSecret('v2.deadbeef.only-one-part', SECRET, CTX)).toThrow(/Malformed secret/);
  });

  // Unset config is the default, and it must fail loudly rather than encrypting
  // under an empty key.
  it('refuses to work with no secret configured', () => {
    expect(() => encryptSecret('x', '', CTX)).toThrow(SecretBoxError);
    expect(() => decryptSecret('v2.deadbeef.a.b.c', '', CTX)).toThrow(SecretBoxError);
  });

  // A secret of any length has to become a 32-byte key, so nothing here may
  // depend on the input already being the right size.
  it('takes a secret of any length', () => {
    for (const secret of ['x', 'a'.repeat(200)]) {
      expect(decryptSecret(encryptSecret('token', secret, CTX), secret, CTX)).toBe('token');
    }
  });

  /** Derive separate purpose keys from one root secret so feedback tokens, OAuth state, and access tokens cannot
   * share a key. */
  describe('purpose separation', () => {
    it('cannot open a value sealed for another purpose', () => {
      const sealed = encryptSecret('shra_live_token', SECRET, { purpose: 'shirabe.access-token' });

      expect(() => decryptSecret(sealed, SECRET, { purpose: 'shirabe.oauth-state' })).toThrow(SecretBoxError);
    });

    it('derives unrelated keys from the same secret', () => {
      // Not merely "different output" -- the nonce alone would do that. This is
      // the round trip failing, which is the key differing.
      const a = encryptSecret('same', SECRET, { purpose: 'a' });

      expect(decryptSecret(a, SECRET, { purpose: 'a' })).toBe('same');
      expect(() => decryptSecret(a, SECRET, { purpose: 'b' })).toThrow(SecretBoxError);
    });
  });

  /** Authenticated encryption does not prevent swapping valid ciphertexts between rows; binding the owner into the
   * tag makes a ciphertext for another row fail. */
  describe('owner binding', () => {
    it('refuses a ciphertext moved to another owner', () => {
      const mine = encryptSecret('shra_live_token', SECRET, { purpose: 'shirabe.access-token', aad: '42' });

      expect(decryptSecret(mine, SECRET, { purpose: 'shirabe.access-token', aad: '42' })).toBe('shra_live_token');
      expect(() => decryptSecret(mine, SECRET, { purpose: 'shirabe.access-token', aad: '43' })).toThrow(SecretBoxError);
    });

    it('refuses a ciphertext whose owner was dropped entirely', () => {
      const bound = encryptSecret('shra_live_token', SECRET, { purpose: 'shirabe.access-token', aad: '42' });

      expect(() => decryptSecret(bound, SECRET, { purpose: 'shirabe.access-token' })).toThrow(SecretBoxError);
    });
  });

  /** Support rotation as a background job by accepting both configured keys and opening each row with the key that
   * sealed it. */
  describe('key rotation', () => {
    const OLD = 'the-previous-secret-long-enough-x';

    it('opens rows sealed by either configured key', () => {
      const old = encryptSecret('sealed-before', OLD, CTX);
      const current = encryptSecret('sealed-after', SECRET, CTX);

      expect(decryptSecret(old, [SECRET, OLD], CTX)).toBe('sealed-before');
      expect(decryptSecret(current, [SECRET, OLD], CTX)).toBe('sealed-after');
    });

    it('names the missing key rather than failing as a bad password', () => {
      const old = encryptSecret('sealed-before', OLD, CTX);

      // The operator error this exists to describe: rotating without keeping the
      // outgoing key readable until every row has been rewritten.
      expect(() => decryptSecret(old, [SECRET], CTX)).toThrow(/not among the configured keys/);
    });

    it('stamps the key id in the clear so a row can be attributed', () => {
      const [version, keyId] = encryptSecret('x', SECRET, CTX).split('.');

      expect(version).toBe('v2');
      expect(keyId).toMatch(/^[0-9a-f]{8}$/);
      // Same secret, same id -- otherwise nothing could be found on rotation.
      expect(encryptSecret('y', SECRET, CTX).split('.')[1]).toBe(keyId);
      expect(encryptSecret('z', OLD, CTX).split('.')[1]).not.toBe(keyId);
    });
  });

  /** Retain the v1 format for existing rows: SHA-256 of the secret, with no purpose or associated data, so a deploy
   * does not invalidate stored values. */
  describe('the v1 format', () => {
    function sealV1(plaintext: string, secret: string): string {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret, 'utf8').digest(), nonce);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return ['v1', nonce, cipher.getAuthTag(), ciphertext]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    }

    it('still opens, whatever purpose is asked for', () => {
      const legacy = sealV1('shra_live_token', SECRET);

      expect(decryptSecret(legacy, SECRET, CTX)).toBe('shra_live_token');
      expect(decryptSecret(legacy, SECRET, { purpose: 'anything.else' })).toBe('shra_live_token');
    });

    it('is only ever read, never written', () => {
      expect(encryptSecret('x', SECRET, CTX).startsWith('v1.')).toBe(false);
    });
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
