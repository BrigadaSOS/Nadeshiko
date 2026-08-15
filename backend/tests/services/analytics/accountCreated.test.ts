import { captureAccountCreatedAfterUserCreate } from '@config/auth';
import { describe, expect, it, vi } from 'vitest';

/**
 * The hook that records a new account server-side.
 *
 * It exists because the browser's `signup_completed` is only as reliable as the
 * reader's content blocker, and it therefore has one job that must not fail: fire
 * exactly once per account that reaches the database. These tests are about that
 * guarantee -- and about the guard around it, since nothing here is worth failing
 * a sign-up for.
 */
describe('captureAccountCreatedAfterUserCreate', () => {
  const completeUser = {
    id: 42,
    name: 'someone',
    email: 'someone@example.test',
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
  };

  it('reports the account keyed on the id the browser also identifies with', () => {
    // The whole design rests on this: the server's count and the browser's
    // attribution have to land on one PostHog person, and the numeric account id
    // is the only thing both sides can agree on.
    const capture = vi.fn();

    captureAccountCreatedAfterUserCreate(completeUser, capture);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      userId: '42',
      username: 'someone',
      email: 'someone@example.test',
      createdAt: completeUser.createdAt,
    });
  });

  it('passes a string createdAt through untouched', () => {
    const capture = vi.fn();

    captureAccountCreatedAfterUserCreate({ ...completeUser, createdAt: '2026-08-16T00:00:00.000Z' }, capture);

    expect(capture.mock.calls[0]?.[0]).toMatchObject({ createdAt: '2026-08-16T00:00:00.000Z' });
  });

  it.each([
    ['a shape it does not understand', { foo: 'bar' }],
    ['nothing at all', undefined],
  ])('drops createdAt when it is %s, rather than throwing inside a sign-up', (_label, createdAt) => {
    // It arrives through the hook's index signature, so its runtime shape is not
    // guaranteed by the type. The capture falls back to the current time.
    const capture = vi.fn();

    captureAccountCreatedAfterUserCreate({ ...completeUser, createdAt }, capture);

    expect(capture.mock.calls[0]?.[0]).toMatchObject({ createdAt: undefined });
  });

  it.each([
    ['no id', { ...completeUser, id: undefined }],
    ['no email', { ...completeUser, email: null }],
    ['no name', { ...completeUser, name: '' }],
  ])('stays silent for a user with %s', (_label, user) => {
    // A half-formed user would produce a person with no way to join it back to
    // our own database, which is worse than no event.
    const capture = vi.fn();

    captureAccountCreatedAfterUserCreate(user, capture);

    expect(capture).not.toHaveBeenCalled();
  });
});
