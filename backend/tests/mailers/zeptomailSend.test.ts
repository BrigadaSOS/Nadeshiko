import { describe, it, expect, vi, afterEach } from 'vitest';

/** `config` is frozen at module load, so vary the copied config behind the same Proxy shape used by the
 * lifecycle-gate tests. */
const overrides: Record<string, unknown> = {};

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

const { sendViaZeptomailApi } = await import('@app/mailers/zeptomailSend');
type ZeptomailMessage = import('@app/mailers/zeptomailSend').ZeptomailMessage;

/** This covers the deployed ZeptoMail HTTP transport, which local mailer tests bypass. Assert the exact request
 * fields—especially `mime_headers`—because a wrong field rejects the whole send. */

const MESSAGE: ZeptomailMessage = {
  from: { address: 'noreply@nadeshiko.co', name: 'Nadeshiko' },
  to: 'reader@example.com',
  subject: 'Your sign-in link',
  html: '<p>Hello</p>',
  text: 'Hello',
  clientReference: 'magic-link',
};

const ok = () => new Response(JSON.stringify({ data: [{ code: 'EM_104' }], message: 'OK' }), { status: 201 });

function captureRequest() {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } = {
    url: '',
    headers: {},
    body: {},
  };

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    seen.url = String(url);
    seen.headers = (init?.headers ?? {}) as Record<string, string>;
    seen.body = JSON.parse(String(init?.body ?? '{}'));
    return ok();
  });

  return seen;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete overrides.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN;
});

describe('sending over the ZeptoMail API', () => {
  it('posts the message in the shape ZeptoMail names its fields', async () => {
    const seen = captureRequest();

    await sendViaZeptomailApi(MESSAGE);

    expect(seen.url).toContain('/v1.1/email');
    expect(seen.body.from).toEqual({ address: 'noreply@nadeshiko.co', name: 'Nadeshiko' });
    expect(seen.body.to).toEqual([{ email_address: { address: 'reader@example.com' } }]);
    expect(seen.body.subject).toBe('Your sign-in link');
    expect(seen.body.htmlbody).toBe('<p>Hello</p>');
    expect(seen.body.textbody).toBe('Hello');
  });

  /** The agent split is a configuration option: lifecycle policy changes must not affect transactional mail, while
   * unset values fall back to the shared token. */
  it('sends lifecycle mail through its own agent once one is configured', async () => {
    overrides.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN = 'lifecycle-agent-token';
    const seen = captureRequest();

    await sendViaZeptomailApi({ ...MESSAGE, lifecycle: true });

    expect(seen.headers.Authorization).toBe('Zoho-enczapikey lifecycle-agent-token');
  });

  it('leaves transactional mail on the original agent', async () => {
    overrides.ZEPTOMAIL_LIFECYCLE_SEND_TOKEN = 'lifecycle-agent-token';
    const seen = captureRequest();

    await sendViaZeptomailApi({ ...MESSAGE, lifecycle: false });

    expect(seen.headers.Authorization).not.toContain('lifecycle-agent-token');
  });

  it('falls back to the single agent while no lifecycle token is set', async () => {
    const seen = captureRequest();

    await sendViaZeptomailApi({ ...MESSAGE, lifecycle: true });

    expect(seen.headers.Authorization).toMatch(/^Zoho-enczapikey .+/);
    expect(seen.headers.Authorization).not.toContain('lifecycle-agent-token');
  });

  /** The prefix is part of the credential's format; ZeptoMail refuses the bare token. */
  it('presents the send token as an enczapikey credential', async () => {
    const seen = captureRequest();

    await sendViaZeptomailApi(MESSAGE);

    expect(seen.headers.Authorization).toMatch(/^Zoho-enczapikey .+/);
  });

  /** Every message needs plaintext; omitting it harms deliverability for the agent that also carries sign-in mail. */
  it('never sends an HTML-only message', async () => {
    const seen = captureRequest();

    await sendViaZeptomailApi({ ...MESSAGE, text: 'A plain reading of it' });

    expect(seen.body.textbody).toBe('A plain reading of it');
  });

  /** This returned field links a later bounce to the message that caused it. */
  it('carries the client reference', async () => {
    const seen = captureRequest();

    await sendViaZeptomailApi({ ...MESSAGE, clientReference: 'recap:recap-2026-08' });

    expect(seen.body.client_reference).toBe('recap:recap-2026-08');
  });

  describe('the unsubscribe headers', () => {
    /** RFC 8058: both headers, or neither. */
    it('sends both when there is a link', async () => {
      const seen = captureRequest();

      await sendViaZeptomailApi({ ...MESSAGE, unsubscribeUrl: 'https://nadeshiko.co/v1/email/unsubscribe?token=x' });

      expect(seen.body.mime_headers).toEqual({
        'List-Unsubscribe': '<https://nadeshiko.co/v1/email/unsubscribe?token=x>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      });
    });

    /** Transactional mail omits unsubscribe headers so a sign-in link cannot lock the recipient out; an unusable
     * provider button is worse than none. */
    it('omits them entirely when there is not', async () => {
      const seen = captureRequest();

      await sendViaZeptomailApi(MESSAGE);

      expect(seen.body.mime_headers).toBeUndefined();
      // `headers` is not merely unused, it is REFUSED: ZeptoMail rejects the
      // whole request with TM_3301 / GE_121 if that key is present.
      expect(seen.body.headers).toBeUndefined();
    });
  });

  describe('when ZeptoMail refuses', () => {
    it('throws naming the code, so the log line is worth reading', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: { code: 'TM_3201', message: 'Invalid from address' } }), {
            status: 400,
          }),
      );

      await expect(sendViaZeptomailApi(MESSAGE)).rejects.toThrow(/TM_3201/);
    });

    /** An edge failure may be non-JSON; preserve its status instead of replacing it with a JSON parse stack trace. */
    it('still reports a status when the body is not JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      );

      await expect(sendViaZeptomailApi(MESSAGE)).rejects.toThrow(/502/);
    });
  });
});
