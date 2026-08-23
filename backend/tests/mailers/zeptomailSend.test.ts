import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * `config` is frozen at module load, so varying the agent token means standing
 * something else in front of it. Same shape as `lifecycleGate.test.ts`, and for
 * the same reason -- see the note there on why the Proxy wraps a copy.
 */
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

/**
 * The transport the deployed environments actually use, and the one the rest of
 * the suite cannot reach: tests run as `local`, so every other mailer test goes
 * through letter-opener. Without this file the switch from SMTP to HTTP is
 * covered by nothing at all.
 *
 * What is asserted is the REQUEST, not the plumbing, because ZeptoMail's field
 * names are not guessable and getting one wrong is not a soft failure. The
 * obvious `headers` for custom MIME headers is `mime_headers`, and sending the
 * obvious one earns `TM_3301 Bad Syntax` / `GE_121 An extra key found in the
 * input value` -- the WHOLE REQUEST is refused, so a wrong key here is not a
 * message missing an unsubscribe link, it is every lifecycle send failing.
 * Confirmed against the live JP API on 2026-08-21, which is also how that field
 * name was found; the first implementation used `headers` and would have shipped
 * broken.
 */

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

  /**
   * THE AGENT SPLIT, which is a config change rather than a code one.
   *
   * Everything shares one Agent today. When a recurring recap joins the day-7
   * ask and the win-back, a policy action against it would take magic links with
   * it -- so lifecycle mail gets the option of its own Agent, and transactional
   * mail stays where it is. Unset, both fall back to the single token, which is
   * what these two cases pin.
   */
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

  /**
   * A plaintext part on EVERY message. Its absence is one of the oldest spam
   * heuristics there is, and it would cost reputation on the Agent that also
   * carries sign-in.
   */
  it('never sends an HTML-only message', async () => {
    const seen = captureRequest();

    await sendViaZeptomailApi({ ...MESSAGE, text: 'A plain reading of it' });

    expect(seen.body.textbody).toBe('A plain reading of it');
  });

  /**
   * What ties a bounce three days later back to the message that caused it.
   * Returned on the webhook under this name.
   */
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

    /**
     * Omitted entirely on transactional mail. Offering to unsubscribe from
     * sign-in links invites somebody to lock themselves out of their account,
     * and a `List-Unsubscribe` a provider cannot act on is worse than none.
     */
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

    /**
     * A failure from the edge rather than from ZeptoMail is not JSON, and a
     * parse error here would replace a useful status with a stack trace about
     * JSON.
     */
    it('still reports a status when the body is not JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      );

      await expect(sendViaZeptomailApi(MESSAGE)).rejects.toThrow(/502/);
    });
  });
});
