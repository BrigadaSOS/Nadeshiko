import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendViaZeptomailApi, type ZeptomailMessage } from '@app/mailers/zeptomailSend';

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
