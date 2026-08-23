import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import nodemailer from 'nodemailer';
import { setupTestSuite } from '../helpers/setup';
import { sendEmail, resetTransporterForTests } from '@app/mailers/email';
import { unsubscribeUrls, readUnsubscribeToken } from '@app/services/email/unsubscribe';
import { config } from '@config/config';

setupTestSuite();

let sendMail: ReturnType<typeof vi.fn>;
let createTransport: MockInstance;

beforeEach(() => {
  resetTransporterForTests();
  sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });
  createTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
});

afterEach(() => {
  createTransport.mockRestore();
  resetTransporterForTests();
});

const headersOf = () => sendMail.mock.calls[0][0].headers as Record<string, string>;

describe('List-Unsubscribe', () => {
  it('emits both headers when a lifecycle send supplies a URL', async () => {
    const { oneClick } = unsubscribeUrls(42);

    await sendEmail({
      to: 'a@example.com',
      subject: 'Hi',
      html: '<p>hi</p>',
      kind: 'welcome',
      unsubscribeUrl: oneClick,
    });

    expect(headersOf()['List-Unsubscribe']).toBe(`<${oneClick}>`);
    expect(headersOf()['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  /**
   * Both or neither. A `List-Unsubscribe` a provider cannot act on is worse than
   * none: Gmail renders the button and the reader's click fails, which is the
   * moment they reach for the spam report instead.
   */
  it('emits neither header on transactional mail', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'magic-link' });

    expect(headersOf()).not.toHaveProperty('List-Unsubscribe');
    expect(headersOf()).not.toHaveProperty('List-Unsubscribe-Post');
  });

  it('still carries the kind for bounce attribution', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(headersOf()['X-TM-CLIENT-REF']).toBe('welcome');
  });
});

describe('unsubscribeUrls', () => {
  /**
   * The header URL is POSTed by a mailbox provider with nobody present; the page
   * URL is opened by a reader and must confirm first. Pointing them at the same
   * place breaks one of the two.
   */
  it('separates the one-click target from the page a reader sees', async () => {
    const { oneClick, page } = unsubscribeUrls(42);

    expect(oneClick).toContain('/v1/email/unsubscribe?token=');
    expect(page).toContain('/unsubscribe?token=');
    expect(oneClick).not.toBe(page);
  });

  it('mints a token both links can spend for that account', async () => {
    const { oneClick, page } = unsubscribeUrls(42);

    for (const url of [oneClick, page]) {
      const token = decodeURIComponent(new URL(url).searchParams.get('token') ?? '');
      expect(readUnsubscribeToken(token)).toEqual({ userId: 42 });
    }
  });

  /**
   * Both links carry the category, so the header and the visible link speak for
   * the same list. A one-click out of a recap must not take the day-7 ask with
   * it, and the page must not offer to keep something the header already stopped.
   */
  it('carries the category into both links', async () => {
    const { oneClick, page } = unsubscribeUrls(42, 'recap');

    for (const url of [oneClick, page]) {
      const token = decodeURIComponent(new URL(url).searchParams.get('token') ?? '');
      expect(readUnsubscribeToken(token)).toEqual({ userId: 42, category: 'recap' });
    }
  });

  it('percent-encodes the token so the query survives the URL', async () => {
    const { oneClick } = unsubscribeUrls(7);
    const raw = oneClick.split('token=')[1];

    expect(raw).toBe(encodeURIComponent(decodeURIComponent(raw)));
  });
});

describe('who a message comes from', () => {
  const fromOf = () => sendMail.mock.calls[0][0].from as string;

  it.each(['feedback-ask', 'dormant-30', 'recap'] as const)('sends %s from a real inbox', async (kind) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind });

    expect(fromOf()).toBe(`${config.LIFECYCLE_FROM_NAME} <${config.LIFECYCLE_FROM_EMAIL}>`);
  });

  /**
   * A sign-in link is the account working, not a note from a person. There is
   * nothing to reply to, and inviting a reply that will not be read is worse
   * than not inviting one.
   */
  it.each(['magic-link', 'verify-new-email', 'feedback'] as const)('keeps %s on the no-reply sender', async (kind) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind });

    expect(fromOf()).toBe(`${config.MAIL_FROM_NAME} <${config.MAIL_FROM_EMAIL}>`);
  });

  /**
   * WELCOME IS THE EXCEPTION, and it is a sender exception rather than a kind
   * one. It reads as a note from a person and asks for a reply, so it cannot go
   * out over `noreply@` -- but it must not become a lifecycle kind to get that,
   * because lifecycle kinds are gated and a welcome email that stops arriving
   * when the newsletter is off is an outage.
   */
  it('sends welcome from the personal address without gating it', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(fromOf()).toBe(`${config.LIFECYCLE_FROM_NAME} <${config.LIFECYCLE_FROM_EMAIL}>`);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  /**
   * A personal email comes from a person, and which one is decided by the reader
   * rather than by configuration. Transactional mail keeps the one identity it
   * has always had -- there is nobody to reply to on a sign-in link.
   */
  it.each([
    [1, 'Natsume'],
    [2, 'Dav'],
  ])('sends a reader with id %i their own sender', async (userId, expected) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'feedback-ask', userId });

    expect(fromOf()).toContain(expected);
  });

  it('leaves transactional mail on the configured address whoever the reader is', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'magic-link', userId: 1 });

    expect(fromOf()).toBe(`${config.MAIL_FROM_NAME} <${config.MAIL_FROM_EMAIL}>`);
  });

  /**
   * The two senders have to actually differ, or the routing above is a no-op
   * that every assertion still passes.
   */
  it('does not send lifecycle mail from the transactional address', async () => {
    expect(config.LIFECYCLE_FROM_EMAIL).not.toBe(config.MAIL_FROM_EMAIL);
  });
});

describe('the plaintext alternative', () => {
  /**
   * An HTML-only message is a spam-filter signal in its own right, and this is
   * the one place it can be got wrong for every email at once — `sendEmail` is
   * the only caller of the transport.
   */
  it('rides along with every send', async () => {
    await sendEmail({
      to: 'a@example.com',
      subject: 'Hi',
      html: '<p>Hello</p><a href="https://nadeshiko.co/x">Go</a>',
      kind: 'welcome',
    });

    const sent = sendMail.mock.calls[0][0];
    expect(sent.text).toBe('Hello\n\nGo (https://nadeshiko.co/x)');
    expect(sent.html).toContain('<p>Hello</p>');
  });
});
