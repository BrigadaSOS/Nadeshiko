import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Encrypt secrets that must later be used: AES-256-GCM authenticates ciphertext, random nonces prevent equality
 * checks, and purpose-derived keys isolate features. Format: `v2.<keyId>.<nonce>.<tag>.<ciphertext>`. */

const VERSION = 'v2';
/** The v1 format remains readable so rotation does not invalidate existing stored secrets. */
const LEGACY_VERSION = 'v1';
const NONCE_BYTES = 12; // GCM standard; 96 bits is what the mode is specified for
const KEY_BYTES = 32;

/** Derive the purpose key and authenticate owner AAD without encrypting it; binding the row owner prevents moving a
 * valid ciphertext to another reader. */
export interface SealContext {
  purpose: string;
  aad?: string;
}

/** HKDF turns deploy key material into a fixed-size, purpose-separated key; it is not a password KDF because config
 * supplies generated secrets. */
function keyFor(secret: string, purpose: string): Buffer {
  const key = Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), `secretBox:${purpose}`, KEY_BYTES),
  );
  if (key.length !== KEY_BYTES) throw new Error('secretBox: derived key is the wrong size');
  return key;
}

/** The v1 key: a bare SHA-256 of the secret, shared by every purpose. Only for
 *  reading what was written before purposes existed. */
function legacyKeyFrom(secret: string): Buffer {
  const key = createHash('sha256').update(secret, 'utf8').digest();
  if (key.length !== KEY_BYTES) throw new Error('secretBox: derived key is the wrong size');
  return key;
}

/** Store a secret-derived key ID so rotation can read current/previous keys together and re-encrypt rows without
 * guessing or losing track of the old key. */
function keyIdFor(secret: string): string {
  return createHash('sha256').update(`secretBox:key-id:${secret}`, 'utf8').digest('hex').slice(0, 8);
}

/** The key ID identifies the sealing key without decrypting; re-encryption can sort on it. */
export function keyIdOf(payload: string): string | null {
  const [version, keyId] = payload.split('.');
  if (version !== VERSION) return null;
  return keyId || null;
}

/** The id the CURRENT secret stamps. Anything not matching it is a row a
 *  rotation has yet to reach -- including v1 rows, which carry no id at all. */
export function currentKeyId(secret: string): string {
  return keyIdFor(secret);
}

function aadFor(context: SealContext): Buffer {
  return Buffer.from(`${context.purpose}\u0000${context.aad ?? ''}`, 'utf8');
}

export class SecretBoxError extends Error {}

export function encryptSecret(plaintext: string, secret: string, context: SealContext): string {
  if (!secret) throw new SecretBoxError('No encryption secret is configured');

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, context.purpose), nonce);
  cipher.setAAD(aadFor(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [VERSION, keyIdFor(secret), nonce, cipher.getAuthTag(), ciphertext].map(encodePart).join('.');
}

/** The current and rotating-out secrets may be supplied in any order; the payload key ID selects the applicable key
 * without trial decryption. */
export function decryptSecret(payload: string, secrets: string | string[], context: SealContext): string {
  const candidates = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  if (candidates.length === 0) throw new SecretBoxError('No encryption secret is configured');

  const parts = payload.split('.');
  const version = parts[0];
  if (version !== VERSION && version !== LEGACY_VERSION) {
    throw new SecretBoxError(`Unknown secret format: ${version}`);
  }

  const legacy = version === LEGACY_VERSION;
  const [keyId, nonce, tag, ciphertext] = legacy ? [null, ...parts.slice(1)] : parts.slice(1);
  if (!nonce || !tag || !ciphertext) throw new SecretBoxError('Malformed secret');

  // Named rather than tried: a payload whose key is not configured is a rotation
  // mistake, and saying so beats four identical auth failures.
  const secret = legacy ? candidates[0] : candidates.find((candidate) => keyIdFor(candidate) === keyId);
  if (!secret) {
    throw new SecretBoxError(
      `Could not decrypt: this value was sealed with key ${keyId}, which is not among the configured keys. ` +
        'Restore it alongside the current one until every stored row has been re-encrypted.',
    );
  }

  try {
    const key = legacy ? legacyKeyFrom(secret) : keyFor(secret, context.purpose);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
    // v1 sealed nothing alongside the plaintext, so there is no associated data
    // to reproduce; setting any would fail every stored row.
    if (!legacy) decipher.setAAD(aadFor(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    // The one failure worth naming separately, because it is the one an operator
    // causes: rotating the secret without re-encrypting what was stored under
    // the old one. Every stored row fails to open at once, and "unable to
    // authenticate data" on its own does not say why.
    throw new SecretBoxError(
      'Could not decrypt. The stored value is corrupt, belongs to another owner, or was sealed for ' +
        `another purpose than "${context.purpose}" (${(error as Error).message})`,
    );
  }
}

function encodePart(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url');
}

/** Use constant-time comparison for secret values such as OAuth `state` to prevent character-by-character guessing. */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
