import { randomInt } from 'node:crypto';
import { config } from '@config/config';
import { encryptSecret, decryptSecret } from '@lib/secretBox';

/**
 * The typed half of an emailed sign-in.
 *
 * The link and the code prove the same thing -- that somebody can read that
 * mailbox -- and exist side by side because they are reached differently. The
 * link is portable: it works in whatever browser opens it, which is what you
 * want when the mail and the browser are on the same phone. The code is for the
 * case the link cannot serve, where the mail is on one device and the session is
 * wanted on another.
 *
 * THE CODE IS BOUND TO THE BROWSER THAT ASKED FOR IT, and that is what makes six
 * characters affordable. A string short enough to read aloud is a string
 * somebody can be talked into reading aloud, and an unbound code is usable by
 * whoever hears it. Bound, it is worthless anywhere but the browser that asked,
 * so the phone call that asks for it gains the caller nothing.
 *
 * Ported from shirabe's `LoginToken`, whose reasoning this follows. The
 * mechanism differs: better-auth owns the verification row here and we cannot
 * stash its id, so the binding is over the ADDRESS rather than the row. That
 * pins the browser rather than the individual send, which is a slightly weaker
 * claim and enough for what the binding is for.
 */

/**
 * No `I`, `O`, `0` or `1`. A code is read off one screen and typed into another,
 * and those four are where that goes wrong. Thirty-two characters, six of them:
 * 30 bits, against five attempts.
 */
export const LOGIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const LOGIN_CODE_LENGTH = 6;

/**
 * Five wrong guesses and better-auth burns the row. From the one browser that
 * asked for this code that is either an attack or a lost cause, and starting
 * over costs a click.
 */
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

/**
 * Accepts `x5kdnz`, `X5KD-NZ`, `x5k dnz` -- all of which mean `X5KDNZ`.
 *
 * Punctuation is DROPPED RATHER THAN REFUSED. Somebody whose password manager
 * added a space, or who typed the dash they are used to from other codes, has
 * not made a mistake worth an error message. Returns null only when what is left
 * is the wrong length, because that is the one case where we would be guessing.
 */
export function normalizeLoginCode(input: string | null | undefined): string | null {
  const cleaned = (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length === LOGIN_CODE_LENGTH ? cleaned : null;
}

interface Binding {
  email: string;
  issuedAt: number;
}

/**
 * The sealed claim a browser gets when it asks for a code, and must present to
 * spend one. Sealed rather than signed so the address is not readable out of the
 * cookie jar of a shared machine.
 */
export function issueLoginCodeBinding(email: string): string {
  return encryptSecret(
    JSON.stringify({ email: email.trim().toLowerCase(), issuedAt: Date.now() } satisfies Binding),
    config.BETTER_AUTH_SECRET,
    BINDING_CONTEXT,
  );
}

/**
 * The address this browser may spend a code for, or null.
 *
 * Expiry is checked here as well as by better-auth's own row: this cookie is
 * what says "this browser asked", and a claim that outlived the code it was
 * issued beside would let a browser spend a LATER code it never requested.
 */
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

/**
 * One cookie out of the header, without adding a parser for it.
 *
 * Split on `;` and on the FIRST `=` only. A sealed value is base64url separated
 * by dots and carries no `=` today, but reading a cookie by splitting on every
 * `=` is the bug that surfaces the day one does.
 *
 * A VALUE THAT WILL NOT DECODE MUST NOT THROW. `decodeURIComponent` raises on a
 * malformed percent-sequence, and the caller is middleware on the code-spend
 * path with nothing to catch it: a corrupted or crafted cookie would answer 500
 * where the flow has a clean 400 to give. Our own values are base64url with
 * dots and are never legitimately percent-encoded, so a value that fails to
 * decode was not ours -- handing back the raw slice lets it fail as an unusable
 * binding, which is the same outcome as no cookie at all.
 */
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
