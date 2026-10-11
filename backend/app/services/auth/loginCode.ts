import { randomInt } from 'node:crypto';
import { config } from '@config/config';
import { encryptSecret, decryptSecret } from '@lib/secretBox';

/** Bind short login codes to the requesting browser and email address to resist relayed-code attacks; email links
 * remain portable. Better Auth owns the verification row, so the binding covers the address, not an individual
 * send. */

/** Exclude lookalike characters so codes are easy to read and type across screens. */
export const LOGIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const LOGIN_CODE_LENGTH = 6;

/** Exhausted guesses burn the verification row; request a new code rather than retrying it. */
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

/** Matches the magic link's own expiry: one mail, one clock, as far as a reader can tell. */
export const LOGIN_CODE_TTL_MS = 15 * 60 * 1000;

export const LOGIN_CODE_COOKIE = 'nd-login-code';

const BINDING_CONTEXT = { purpose: 'auth.login-code-binding' } as const;

/** `randomInt` rather than `Math.random`: this is a credential, however short. */
export function generateLoginCode(): string {
  let code = '';
  for (let i = 0; i < LOGIN_CODE_LENGTH; i += 1) {
    code += LOGIN_CODE_ALPHABET[randomInt(LOGIN_CODE_ALPHABET.length)];
  }
  return code;
}

/** Normalize case and separators; return null for the wrong final length instead of guessing a code. */
export function normalizeLoginCode(input: string | null | undefined): string | null {
  const cleaned = (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length === LOGIN_CODE_LENGTH ? cleaned : null;
}

interface Binding {
  email: string;
  issuedAt: number;
}

/** Seal the browser binding rather than signing it, so a shared machine's cookie does not expose the address. */
export function issueLoginCodeBinding(email: string): string {
  return encryptSecret(
    JSON.stringify({ email: email.trim().toLowerCase(), issuedAt: Date.now() } satisfies Binding),
    config.BETTER_AUTH_SECRET,
    BINDING_CONTEXT,
  );
}

/** Reject an expired browser binding as well as an expired Better Auth row; an old claim must not spend a later
 * code. */
export function readLoginCodeBinding(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  try {
    const binding = JSON.parse(decryptSecret(sealed, config.BETTER_AUTH_SECRET, BINDING_CONTEXT)) as Binding;
    if (!binding?.email || !Number.isFinite(binding.issuedAt)) return null;
    if (Date.now() - binding.issuedAt > LOGIN_CODE_TTL_MS) return null;

    return binding.email;
  } catch {
    return null;
  }
}

/** Split cookies at the first `=` and never throw on malformed percent-encoding; bad values must become unusable
 * bindings, not 500s. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}
