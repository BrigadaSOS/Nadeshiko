import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

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
 * Format: `v2.<keyId>.<nonce>.<tag>.<ciphertext>`, all base64url after the two
 * labels. The version prefix is what makes rotating the CIPHER a migration
 * rather than a guess about what each stored row was written with; `keyId` is
 * what makes rotating the KEY possible at all -- see `keyIdFor`.
 *
 * Every call names a PURPOSE, and that is not bookkeeping. Two features sharing
 * one root secret must not share a key: the feedback form token is sealed with
 * `BETTER_AUTH_SECRET`, the same value that secures sessions, and the Shirabe
 * connection sealed its OAuth `state` with the very key that encrypts stored
 * tokens. Each purpose now derives its own key by HKDF, so a weakness in one
 * cannot be carried into another, and a ciphertext from one context cannot be
 * opened in another even by its rightful owner.
 */

const VERSION = 'v2';
/** The format this replaced: `v1.<nonce>.<tag>.<ciphertext>`, keyed by a plain
 *  SHA-256 of the secret, no purpose and no key id. Still readable so a deploy
 *  does not invalidate what is already stored. */
const LEGACY_VERSION = 'v1';
const NONCE_BYTES = 12; // GCM standard; 96 bits is what the mode is specified for
const KEY_BYTES = 32;

/**
 * What this ciphertext was sealed FOR, and what it belongs TO.
 *
 * `purpose` picks the key: one root secret, a separate derived key per feature,
 * so nothing sealed for one can be opened as another.
 *
 * `aad` is authenticated but NOT encrypted, and it is what stops a ciphertext
 * being moved. Without it a `tokenCiphertext` lifted from one reader's row and
 * pasted into another's decrypts perfectly happily -- the bytes are valid, they
 * simply belong to someone else. Naming the row's owner here makes the tag fail
 * instead. It has to be reproducible at decryption time, so it is an id rather
 * than anything that can be edited.
 */
export interface SealContext {
  purpose: string;
  aad?: string;
}

/**
 * The passphrase from config becomes a per-purpose key by HKDF.
 *
 * A secret is a human-supplied string of any length and AES needs exactly 32
 * bytes, so something has to bridge the two. This used to be a bare SHA-256,
 * which sized it correctly but gave every caller sharing a secret the same key.
 * HKDF sizes it AND separates it: same root, different `info`, unrelated keys.
 *
 * It is still not a slow KDF and is not meant to be -- the input is generated
 * key material from the deploy environment, not a password a person chose, so
 * there is nothing to slow an attacker down for. `config` enforces that.
 */
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

/**
 * A short, stable label for WHICH root secret sealed something.
 *
 * The whole of key rotation rests on this. Without it a stored row says nothing
 * about the key it was written under, so rotating means decrypting everything
 * with the old value in one pass and hoping nothing is missed -- and is simply
 * impossible if the old value is already gone. With it, both keys can be
 * configured at once: new writes use the current one, old rows keep opening
 * under the previous one, and re-encryption becomes a background job rather than
 * a migration with a deadline.
 *
 * Derived from the secret rather than configured beside it, so the two cannot
 * drift apart. Truncated to 8 hex characters: it only has to tell a handful of
 * candidate keys apart, and it is stored in the clear beside the ciphertext.
 */
function keyIdFor(secret: string): string {
  return createHash('sha256').update(`secretBox:key-id:${secret}`, 'utf8').digest('hex').slice(0, 8);
}

/** Which key sealed this, without opening it. What a re-encryption pass sorts on
 *  -- and it needs no key at all, so a row can be attributed even by something
 *  that could not decrypt it. */
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

/**
 * @param secrets The current root secret, or several while one is being rotated
 *                out. The `keyId` in the payload picks which one applies, so
 *                order does not matter and a wrong guess is never attempted.
 */
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
