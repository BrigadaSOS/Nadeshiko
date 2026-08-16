import { describe, it, expect } from 'vitest';
import {
  MonthlyQuotaExceededError,
  NadeshikoError,
  RateLimitExceededError,
  buildNadeshikoError,
  type NadeshikoProblemDetails,
} from '../generated/internal/errors';

const problem = (overrides: Partial<NadeshikoProblemDetails> = {}): NadeshikoProblemDetails => ({
  code: 'RATE_LIMIT_EXCEEDED',
  title: 'Rate Limit Exceeded',
  detail: 'Too many requests. Please try again later.',
  status: 429,
  ...overrides,
});

describe('buildNadeshikoError', () => {
  /**
   * The whole point of the reason header. Both of these are 429s, and a caller
   * that treats them alike either gives up on a burst that would have cleared
   * in seconds, or retries a monthly cap until the 1st.
   */
  it('separates a spent month from a burst', () => {
    const monthly = buildNadeshikoError(problem({ code: 'QUOTA_EXCEEDED', rateLimitReason: 'monthly_quota' }));
    const burst = buildNadeshikoError(problem({ rateLimitReason: 'key_burst' }));

    expect(monthly).toBeInstanceOf(MonthlyQuotaExceededError);
    expect(burst).toBeInstanceOf(RateLimitExceededError);
    expect(burst).not.toBeInstanceOf(MonthlyQuotaExceededError);
  });

  /**
   * `QUOTA_EXCEEDED` covers two different things -- the account's month, and a
   * single key's refill budget -- which is exactly why the code alone could not
   * drive this. A key's budget refills on its own, so it is the retryable one
   * despite sharing a code with the month.
   */
  it('reads the header rather than the problem-details code', () => {
    const keyUsage = buildNadeshikoError(problem({ code: 'QUOTA_EXCEEDED', rateLimitReason: 'key_usage' }));

    expect(keyUsage).toBeInstanceOf(RateLimitExceededError);
    expect(keyUsage).not.toBeInstanceOf(MonthlyQuotaExceededError);
  });

  it('carries the numbers a caller needs to act on', () => {
    const burst = buildNadeshikoError(problem({ rateLimitReason: 'ip_burst', retryAfterSeconds: 42 }));
    expect(burst.retryAfterSeconds).toBe(42);

    const monthly = buildNadeshikoError(
      problem({ rateLimitReason: 'monthly_quota', quotaResetsAt: '2026-08-31T23:59:59.999Z' }),
    ) as MonthlyQuotaExceededError;
    expect(monthly.resetsAt?.toISOString()).toBe('2026-08-31T23:59:59.999Z');
  });

  // The deployment this SDK talks to may predate the header. Falling back to
  // the base class keeps every existing `instanceof NadeshikoError` caller
  // working rather than trading one broken distinction for another.
  it('falls back to the base error when the response says nothing', () => {
    const error = buildNadeshikoError(problem());

    expect(error).toBeInstanceOf(NadeshikoError);
    expect(error).not.toBeInstanceOf(RateLimitExceededError);
    expect(error.rateLimitReason).toBeUndefined();
  });

  // The subclasses are still NadeshikoErrors, so nothing that catches the base
  // class stops catching them.
  it('keeps the subclasses catchable as the base error', () => {
    expect(buildNadeshikoError(problem({ rateLimitReason: 'monthly_quota' }))).toBeInstanceOf(NadeshikoError);
    expect(buildNadeshikoError(problem({ rateLimitReason: 'ip_burst' }))).toBeInstanceOf(NadeshikoError);
  });

  it('names itself so a log line says which one it was', () => {
    expect(buildNadeshikoError(problem({ rateLimitReason: 'monthly_quota' })).name).toBe('MonthlyQuotaExceededError');
    expect(buildNadeshikoError(problem({ rateLimitReason: 'key_burst' })).name).toBe('RateLimitExceededError');
  });
});
