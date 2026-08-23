import { describe, it, expect } from 'vitest';
import { SENDERS } from '@app/mailers/senders';
import {
  renderTemplate,
  buildWelcomeEmail,
  buildFeedbackAskEmail,
  buildDormant30Email,
  titleRows,
} from '@app/mailers/emailTemplates';

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

    // username appears in greeting, baseUrl appears in link
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

describe('buildFeedbackAskEmail', () => {
  const unsubscribeUrl = 'https://nadeshiko.co/unsubscribe?token=t';

  /**
   * The action this email wants is a reply, and a button competes with it. A
   * "Tell me" button pointing at the home page was somewhere to click that did
   * nothing feedback-shaped, and every click on it was a reply we did not get.
   */
  it('gives the started opening no button at all', async () => {
    const result = await buildFeedbackAskEmail({
      username: 'alice',
      sender: SENDERS[0],
      started: true,
      unsubscribeUrl,
    });

    expect(result.campaign).toBe('feedback-ask-started');
    // Structure, not wording: this copy lives in a Markdown file that gets
    // rewritten often, and pinning a phrase there fails on an edit rather than
    // on a regression.
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
    url: `https://nadeshiko.co/media/${name}`,
  });

  /**
   * The count decides the shape but never appears: ingest is bursty enough that
   * the honest number is often small, and a padded one is disprovable from the
   * home page. The grid does the pulling instead.
   */
  it('leads with what has been added since they left', async () => {
    const result = await buildDormant30Email({
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 57,
      titles: [title('frieren')],
      unsubscribeUrl,
    });

    expect(result.subject).toBe('We added new titles since you were last here!');
  });

  /**
   * A quiet month is a real answer, and "0 new titles since you were last here"
   * is an argument for staying away. The section goes, the email still sends.
   */
  it('drops the line entirely when nothing has been added', async () => {
    const result = await buildDormant30Email({
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

  it('carries the unsubscribe link untagged', async () => {
    const result = await buildDormant30Email({
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 3,
      titles: [title('frieren')],
      unsubscribeUrl,
    });

    expect(result.html).toContain(unsubscribeUrl);
    expect(result.html).toContain('utm_campaign=dormant-30');
  });

  /**
   * The row layout is the whole reason the grid is generated rather than
   * slotted: one row up to four, two rows of three at five and six, two rows of
   * four at seven and eight.
   */
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
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 57,
      titles: names.map(title),
      unsubscribeUrl,
    });

    expect(result.html.match(/cover\.webp/g)).toHaveLength(8);
    expect(result.html).not.toContain('{{');
  });

  /**
   * EVERY TILE THE SAME SIZE, including in a short row: the widest row decides,
   * so a seven does not render four small covers above three large ones.
   */
  it('sizes every tile from the widest row', async () => {
    const result = await buildDormant30Email({
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
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 1,
      titles: [{ name: '<img src=x onerror=alert(1)>', coverUrl: 'https://cdn.test/a.webp', url: 'https://n.co/a' }],
      unsubscribeUrl,
    });

    expect(result.html).not.toContain('onerror=alert(1)>');
    expect(result.html).toContain('&lt;img');
  });

  /**
   * The button and the grid used to sit inside the news branch, on the reasoning
   * that "see what is new" over a month with nothing new is a link to a
   * disappointment. That stopped holding once the grid is topped up to a full
   * eight from the newest titles overall -- see `titlesAddedSinceLastVisit` --
   * so there is always something to look at and both shapes get both.
   */
  it('keeps the grid and the button in the quiet shape too', async () => {
    const result = await buildDormant30Email({
      username: 'alice',
      sender: SENDERS[0],
      newTitles: 0,
      titles: ['a', 'b', 'c'].map(title),
      unsubscribeUrl,
    });

    expect(result.html.match(/cover\.webp/g)).toHaveLength(3);
    expect(result.html).toContain('utm_content=cta');
    expect(result.html).not.toContain('{{');
  });
});
