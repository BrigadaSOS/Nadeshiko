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

  /** The header and visible link must both work or both be absent; a provider-rendered button that fails invites a
   * spam report. */
  it('emits neither header on transactional mail', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'magic-link' });

    expect(headersOf()).not.toHaveProperty('List-Unsubscribe');
    expect(headersOf()).not.toHaveProperty('List-Unsubscribe-Post');
  });

  it('still carries the kind for bounce attribution', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(headersOf()['X-Nadeshiko-Client-Ref']).toBe('welcome');
  });
});

describe('unsubscribeUrls', () => {
  /** The header URL is provider POST-without-user; the page URL is reader GET-with-confirmation. They cannot share
   * one behavior. */
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

  /** Carry the category on both links so opting out of one list cannot alter another or offer contradictory page
   * choices. */
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

  /** A sign-in link is an account action, not a conversation; do not invite replies that are not read. */
  it.each(['magic-link', 'verify-new-email', 'feedback'] as const)('keeps %s on the no-reply sender', async (kind) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind });

    expect(fromOf()).toBe(`${config.MAIL_FROM_NAME} <${config.MAIL_FROM_EMAIL}>`);
  });

  /** WELCOME is the sender exception: it may request a reply, but must remain ungated rather than become a lifecycle
   * kind. */
  it('sends welcome from the personal address without gating it', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'welcome' });

    expect(fromOf()).toBe(`${config.LIFECYCLE_FROM_NAME} <${config.LIFECYCLE_FROM_EMAIL}>`);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  /** Use one lifecycle envelope address. Reader-specific sender details stay in the body; transactional mail keeps
   * its existing identity. Exercise both sender ids because each must resolve to a different person. */
  it.each([[1], [2]])('sends reader %i the one shared lifecycle address', async (userId) => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'feedback-ask', userId });

    expect(fromOf()).toBe(`${config.LIFECYCLE_FROM_NAME} <${config.LIFECYCLE_FROM_EMAIL}>`);
  });

  it('leaves transactional mail on the configured address whoever the reader is', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>hi</p>', kind: 'magic-link', userId: 1 });

    expect(fromOf()).toBe(`${config.MAIL_FROM_NAME} <${config.MAIL_FROM_EMAIL}>`);
  });

  /** Keep the sender addresses distinct; otherwise routing is a no-op that every assertion can miss. */
  it('does not send lifecycle mail from the transactional address', async () => {
    expect(config.LIFECYCLE_FROM_EMAIL).not.toBe(config.MAIL_FROM_EMAIL);
  });
});

describe('the plaintext alternative', () => {
  /** Every message needs a plaintext part; `sendEmail` is the single transport caller, so this is the global
   * safeguard. */
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
