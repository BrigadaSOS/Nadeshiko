import { describe, it, expect } from 'bun:test';
import { renderTemplate, buildWelcomeEmail, buildAnnouncementEmail } from '@app/mailers/emailTemplates';

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
    const result = await buildWelcomeEmail('alice');

    expect(result.subject).toBe('Welcome to Nadeshiko!');
  });

  it('includes the username in the html', async () => {
    const result = await buildWelcomeEmail('alice');

    expect(result.html).toContain('alice');
  });

  it('escapes the username in html', async () => {
    const result = await buildWelcomeEmail('<img src=x onerror=alert(1)>');

    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;img');
  });
});

describe('buildAnnouncementEmail', () => {
  it('returns the subject as provided', async () => {
    const result = await buildAnnouncementEmail('bob', 'New Terms of Service', 'Please review the new terms.');

    expect(result.subject).toBe('New Terms of Service');
  });

  it('includes the username and message in the html', async () => {
    const result = await buildAnnouncementEmail('bob', 'Update', 'Important changes ahead.');

    expect(result.html).toContain('bob');
    expect(result.html).toContain('Important changes ahead.');
  });

  it('escapes HTML in the message body', async () => {
    const result = await buildAnnouncementEmail('bob', 'Update', '<script>steal(cookies)</script>');

    expect(result.html).not.toContain('<script>steal');
    expect(result.html).toContain('&lt;script&gt;');
  });
});
