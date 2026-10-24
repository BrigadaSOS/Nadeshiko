import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { SESv2Client, SendEmailCommand, NotFoundException } from '@aws-sdk/client-sesv2';

/** `config` is frozen at module load, so vary the copied config behind the same Proxy shape used by the
 * lifecycle-gate tests. */
const overrides: Record<string, unknown> = {
  SES_AWS_ACCESS_KEY_ID: 'AKIATEST',
  SES_AWS_SECRET_ACCESS_KEY: 'secret',
  SES_CONFIGURATION_SET: 'nadeshiko-test',
};

vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();

  return {
    ...actual,
    config: new Proxy(
      { ...actual.config },
      { get: (target, key) => (key in overrides ? overrides[key as string] : target[key as keyof typeof target]) },
    ),
  };
});

const { sendViaSes, referenceToTags, deleteSesSuppression, resetSesClientForTests } = await import(
  '@app/mailers/sesSend'
);
type OutboundMessage = import('@app/mailers/sesSend').OutboundMessage;

/** Local mailer tests bypass this transport, so assert the exact SES request: a wrong field rejects the whole send. */

const MESSAGE: OutboundMessage = {
  from: { address: 'noreply@nadeshiko.co', name: 'Nadeshiko' },
  to: 'reader@example.com',
  subject: 'Your sign-in link',
  html: '<p>Hello</p>',
  text: 'Hello',
  clientReference: 'magic-link',
};

let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetSesClientForTests();
  send = vi.spyOn(SESv2Client.prototype, 'send').mockResolvedValue({ MessageId: 'ses-1' } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  overrides.SES_CONFIGURATION_SET = 'nadeshiko-test';
});

function sentInput() {
  const command = send.mock.calls[0][0] as SendEmailCommand;
  expect(command).toBeInstanceOf(SendEmailCommand);
  return command.input;
}

describe('sending over SES', () => {
  it('sends through the configuration set with both bodies and the kind tag', async () => {
    await sendViaSes(MESSAGE);

    const input = sentInput();
    expect(input.FromEmailAddress).toBe('Nadeshiko <noreply@nadeshiko.co>');
    expect(input.Destination).toEqual({ ToAddresses: ['reader@example.com'] });
    expect(input.ConfigurationSetName).toBe('nadeshiko-test');
    expect(input.EmailTags).toEqual([{ Name: 'kind', Value: 'magic-link' }]);
    expect(input.Content?.Simple?.Body?.Html?.Data).toBe('<p>Hello</p>');
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe('Hello');
    expect(input.Content?.Simple?.Headers).toBeUndefined();
    expect(input.ReplyToAddresses).toBeUndefined();
  });

  it('adds Reply-To and the one-click unsubscribe pair only when asked', async () => {
    await sendViaSes({ ...MESSAGE, replyTo: 'reader@example.com', unsubscribeUrl: 'https://nadeshiko.co/u/1' });

    const input = sentInput();
    expect(input.ReplyToAddresses).toEqual(['reader@example.com']);
    expect(input.Content?.Simple?.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://nadeshiko.co/u/1>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('refuses to send without a configuration set, because no bounce would ever come back', async () => {
    overrides.SES_CONFIGURATION_SET = undefined;

    await expect(sendViaSes(MESSAGE)).rejects.toThrow('SES_CONFIGURATION_SET');
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates an SES refusal so sendEmail counts it as a delivery error', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('Email address is not verified.'), { name: 'MessageRejected' }));

    await expect(sendViaSes(MESSAGE)).rejects.toMatchObject({ name: 'MessageRejected' });
  });
});

describe('referenceToTags', () => {
  it('splits kind:campaign into two tags SES accepts', () => {
    expect(referenceToTags('feedback-ask:2026-10')).toEqual([
      { Name: 'kind', Value: 'feedback-ask' },
      { Name: 'campaign', Value: '2026-10' },
    ]);
  });

  it('replaces characters SES rejects in tag values', () => {
    expect(referenceToTags('dormant-30:spring sale.v2')).toEqual([
      { Name: 'kind', Value: 'dormant-30' },
      { Name: 'campaign', Value: 'spring_sale_v2' },
    ]);
  });
});

describe('deleteSesSuppression', () => {
  it('treats an address SES never held as lifted', async () => {
    send.mockRejectedValueOnce(new NotFoundException({ message: 'not found', $metadata: {} }));

    await expect(deleteSesSuppression('reader@example.com')).resolves.toBe(true);
  });

  it('reports any other failure', async () => {
    send.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(deleteSesSuppression('reader@example.com')).rejects.toThrow('AccessDenied');
  });
});
