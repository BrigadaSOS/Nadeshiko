import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Symmetric encryption for secrets we have to store and later USE.
 *
 * Everything else we keep about a person is either public or hashed: a password
 * we never see, an API key we store as a digest. A third party's access token is
 * neither. We have to send it back to them verbatim on every call, so it cannot
 * be a one-way digest, and it is not ours -- it is the reader's access to their
 * own Shirabe account. A database dump must not be a pile of live credentials
 * for another service.
 *
 * AES-256-GCM: authenticated, so a ciphertext that has been tampered with fails
 * to open rather than decrypting to something attacker-chosen. The nonce is
 * random per encryption and travels with the payload, which is why encrypting
 * the same token twice gives two different strings -- do not compare ciphertexts
 * for equality, decrypt and compare the plaintext.
 *
 * Format: `v1.<nonce>.<tag>.<ciphertext>`, all base64url. The version prefix is
 * what makes rotating the cipher later a migration rather than a guess about
 * what each stored row was written with.
 */

const VERSION = 'v1';
const NONCE_BYTES = 12; // GCM standard; 96 bits is what the mode is specified for
const KEY_BYTES = 32;

/**
 * The passphrase from config becomes a key by hashing, not by truncation.
 *
 * A secret is a human-supplied string of any length, and AES needs exactly 32
 * bytes. Padding or slicing the raw string would silently weaken a short one
 * and silently ignore the tail of a long one; SHA-256 uses all of it and always
 * produces the right size. It is NOT a KDF and is not meant to be: the input is
 * a generated 32-byte secret from the deploy environment, not a password a
 * person chose, so there is nothing to slow an attacker down for.
 */
function keyFrom(secret: string): Buffer {
  const key = createHash('sha256').update(secret, 'utf8').digest();
  if (key.length !== KEY_BYTES) throw new Error('secretBox: derived key is the wrong size');
  return key;
}

export class SecretBoxError extends Error {}

export function encryptSecret(plaintext: string, secret: string): string {
  if (!secret) throw new SecretBoxError('No encryption secret is configured');

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [VERSION, nonce, cipher.getAuthTag(), ciphertext].map(encodePart).join('.');
}

export function decryptSecret(payload: string, secret: string): string {
  if (!secret) throw new SecretBoxError('No encryption secret is configured');

  const [version, nonce, tag, ciphertext] = payload.split('.');
  if (version !== VERSION) throw new SecretBoxError(`Unknown secret format: ${version}`);
  if (!nonce || !tag || !ciphertext) throw new SecretBoxError('Malformed secret');

  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    // The one failure worth naming separately, because it is the one an operator
    // causes: rotating the secret without re-encrypting what was stored under
    // the old one. Every stored row fails to open at once, and "unable to
    // authenticate data" on its own does not say why.
    throw new SecretBoxError(
      'Could not decrypt. Either the stored value is corrupt or the encryption secret has changed ' +
        `since it was written (${(error as Error).message})`,
    );
  }
}

function encodePart(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url');
}

/**
 * Constant-time comparison for the values this module's callers check by
 * equality -- an OAuth `state`, which is a secret an attacker would like to
 * guess one character at a time.
 */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
