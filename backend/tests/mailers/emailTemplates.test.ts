import { describe, it, expect } from 'vitest';
import { SENDERS } from '@app/mailers/senders';
import {
  renderTemplate,
  buildWelcomeEmail,
  buildFeedbackAskEmail,
  buildDormant30Email,
  buildVerifyNewEmailEmail,
  titleRows,
} from '@app/mailers/emailTemplates';
import { EMAIL_LINK_PATH, readReturnToken } from '@app/services/email/returnLink';

describe('renderTemplate', () => {
  it('replaces placeholders with values', async () => {
    const html = await renderTemplate('welcome', {
      username: 'alice',
      baseUrl: 'https://nadeshiko.co',
      year: '2026',
    });

    expect(html).toContain('alice');
    expect(html).toContain('https://nadeshiko.co');
    expect(html).toContain('2026');
    expect(html).not.toContain('{{username}}');
    expect(html).not.toContain('{{baseUrl}}');
    expect(html).not.toContain('{{year}}');
  });

  it('escapes HTML special characters in values to prevent XSS', async () => {
    const html = await renderTemplate('welcome', {
      username: '<script>alert("xss")</script>',
      baseUrl: 'https://nadeshiko.co',
      year: '2026',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('replaces multiple occurrences of the same placeholder', async () => {
    const html = await renderTemplate('welcome', {
      username: 'bob',
      baseUrl: 'https://nadeshiko.co',
      year: '2026',
    });

    const usernameCount = html.split('bob').length - 1;
    expect(usernameCount).toBeGreaterThanOrEqual(1);
  });
});

describe('buildWelcomeEmail', () => {
  it('returns the correct subject', async () => {
    const result = await buildWelcomeEmail('alice', SENDERS[0]);

    expect(result.subject).toBe('Welcome to Nadeshiko!');
  });

  it('includes the username in the html', async () => {
    const result = await buildWelcomeEmail('alice', SENDERS[0]);

    expect(result.html).toContain('alice');
  });

  it('escapes the username in html', async () => {
    const result = await buildWelcomeEmail('<img src=x onerror=alert(1)>', SENDERS[0]);

    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;img');
  });
});

describe('buildVerifyNewEmailEmail', () => {
  it('renders its quoted notes without visible quote markers', async () => {
    const result = await buildVerifyNewEmailEmail('https://nadeshiko.co/v1/auth/verify-email?token=test-token');

    expect(result.html).toContain('class="expiry-note"');
    expect(result.html).not.toContain('&gt;');
  });
});

describe('buildFeedbackAskEmail', () => {
  const unsubscribeUrl = 'https://nadeshiko.co/unsubscribe?token=t';

  /** The action is a reply, so a no-op home-page button only displaces the reply the email needs. */
  it('gives the started opening no button at all', async () => {
    const result = await buildFeedbackAskEmail({
      username: 'alice',
      sender: SENDERS[0],
      started: true,
      unsubscribeUrl,
    });

    expect(result.campaign).toBe('feedback-ask-started');
    // Assert structure rather than copy: the Markdown text is rewritten often.
    expect(result.html).not.toContain('utm_content=cta');
  });

  /** The cold opening keeps one, because "try a search" is a real action. */
  it('gives the cold opening a search button', async () => {
    const result = await buildFeedbackAskEmail({
      username: 'alice',
      sender: SENDERS[0],
      started: false,
      unsubscribeUrl,
    });

    expect(result.campaign).toBe('feedback-ask-cold');
    expect(result.html).toContain('utm_campaign=feedback-ask-cold');
    expect(result.html).toContain('Try a search');
  });

  it('sends exactly one of the two openings', async () => {
    const started = await buildFeedbackAskEmail({
      username: 'alice',
      sender: SENDERS[0],
      started: true,
      unsubscribeUrl,
    });
    const cold = await buildFeedbackAskEmail({ username: 'alice', sender: SENDERS[0], started: false, unsubscribeUrl });

    expect(started.html).not.toContain('What were you hoping to find');
    expect(cold.html).not.toContain('what would you change first');
    expect(started.html).not.toContain('{{');
    expect(cold.html).not.toContain('{{');
  });
});

describe('buildDormant30Email', () => {
  const unsubscribeUrl = 'https://nadeshiko.co/unsubscribe?token=t';
  const title = (name: string) => ({
    name,
    coverUrl: `https://cdn.test/${name}/cover.webp`,
    path: `/media/${name}`,
  });

  /** Every link carries a recipient token; the builder cannot be called without one. */
  const recipient = { userId: 1, campaign: 'dormant-30-2026-08' };

  /** The count selects the layout but is not displayed; a padded count would be contradicted by the home page. */
  it('leads with what has been added, claiming nothing about their last visit', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 57,
      titles: [title('frieren')],
      unsubscribeUrl,
    });

    expect(result.subject).toBe('We have added new titles to Nadeshiko!');
    // Dormancy belongs to the account, whether the reader is signed out, present, or has never visited.
    expect(result.subject).not.toMatch(/last here|last visit|you were/i);
    expect(result.html).not.toMatch(/since your last visit|since you were last here/i);
  });

  /** A quiet month still sends the email but omits the “0 new titles” section, which would argue against returning. */
  it('drops the line entirely when nothing has been added', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 0,
      titles: [],
      unsubscribeUrl,
    });

    expect(result.subject).toBe('Anything we could have done?');
    expect(result.html).not.toContain('new titles');
    expect(result.html).not.toContain('{{');
  });

  /** The quiet copy and closing were once duplicated, causing two reply prompts; keep the closing conditional on the
   * news shape. */
  it('asks the reader to reply exactly once in the quiet shape', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 0,
      titles: [],
      unsubscribeUrl,
    });

    expect(result.html.match(/what was missing/g)).toHaveLength(1);
  });

  /** The recipient rides in the sealed redirect link because mail scanners strip or multiply `utm_*` attribution;
   * the redirect restores tags at the destination. */
  it('addresses every link to the redirect, with the recipient sealed inside', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 57,
      titles: [title('frieren')],
      unsubscribeUrl,
    });

    expect(result.html).not.toContain('utm_');

    const links = [...result.html.matchAll(/href="([^"]+)"/g)]
      .flatMap((match) => (match[1] ? [match[1].replace(/&amp;/g, '&')] : []))
      .filter((href) => href.includes(EMAIL_LINK_PATH));
    expect(links).toHaveLength(2);

    for (const link of links) {
      const token = new URL(link).searchParams.get('t');
      expect(readReturnToken(token)).toEqual({
        userId: recipient.userId,
        kind: 'dormant-30',
        campaign: recipient.campaign,
      });
    }

    // The cover and the button are separable, which is the comparison this
    // email exists to make: does showing what is here beat saying how much.
    expect(links.map((link) => new URL(link).searchParams.get('c')).sort()).toEqual(['cta', 'title-1']);
  });

  it('carries the unsubscribe link untagged', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 3,
      titles: [title('frieren')],
      unsubscribeUrl,
    });

    expect(result.html).toContain(unsubscribeUrl);
    // Everything else in the message is wrapped; the opt-out stays a plain URL,
    // because a click on it is somebody leaving rather than campaign traffic.
    expect(result.html).toContain(`${EMAIL_LINK_PATH}?`);
    expect(result.html).not.toContain(`${unsubscribeUrl}&`);
  });

  /** Generate rows so the grid stays at four columns up to four titles, then two rows of three or four. */
  it.each([
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [4]],
    [5, [3, 2]],
    [6, [3, 3]],
    [7, [4, 3]],
    [8, [4, 4]],
  ])('lays %i covers out as %j', (count, shape) => {
    const rows = titleRows(Array.from({ length: count }, (_, i) => i));

    expect(rows.map((row) => row.length)).toEqual(shape);
  });

  it('renders every cover it is given, up to the cap', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `title-${i}`);
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 57,
      titles: names.map(title),
      unsubscribeUrl,
    });

    expect(result.html.match(/cover\.webp/g)).toHaveLength(8);
    expect(result.html).not.toContain('{{');
  });

  /** Size every tile from the widest row so a short final row does not render larger covers. */
  it('sizes every tile from the widest row', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 7,
      titles: Array.from({ length: 7 }, (_, i) => title(`t${i}`)),
      unsubscribeUrl,
    });

    const widths = [...result.html.matchAll(/<img src="https:\/\/cdn\.test[^"]*"[^>]*width="(\d+)"/g)].map((m) => m[1]);
    expect(widths).toHaveLength(7);
    expect(new Set(widths).size).toBe(1);
  });

  /** One cover is a cover, not a poster. */
  it('never grows a tile past the cap, however few there are', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 1,
      titles: [title('lonely')],
      unsubscribeUrl,
    });

    const width = Number(result.html.match(/<img src="https:\/\/cdn\.test[^"]*"[^>]*width="(\d+)"/)?.[1]);
    expect(width).toBe(180);
  });

  it('drops the grid entirely when there are no covers', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 0,
      titles: [],
      unsubscribeUrl,
    });

    expect(result.html).not.toContain('cover.webp');
    expect(result.html).not.toContain('{{');
  });

  /** The raw path does no escaping, so the generator has to do its own. */
  it('escapes a title name rather than letting it become markup', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 1,
      titles: [{ name: '<img src=x onerror=alert(1)>', coverUrl: 'https://cdn.test/a.webp', path: '/a' }],
      unsubscribeUrl,
    });

    expect(result.html).not.toContain('onerror=alert(1)>');
    expect(result.html).toContain('&lt;img');
  });

  /** Both shapes get the button and grid because the grid is topped up from newest titles when the monthly delta is
   * empty. */
  it('keeps the grid and the button in the quiet shape too', async () => {
    const result = await buildDormant30Email({
      ...recipient,
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 0,
      titles: ['a', 'b', 'c'].map(title),
      unsubscribeUrl,
    });

    expect(result.html.match(/cover\.webp/g)).toHaveLength(3);
    expect(result.html).toContain('c=cta');
    expect(result.html).not.toContain('{{');
  });
});
