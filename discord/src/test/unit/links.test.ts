import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * `links.ts` states the invariant this file exists to hold: attribution is on by
 * default and must be opted out of, because "a new link that quietly is not
 * tracked" is invisible for months. That is precisely the kind of regression a
 * reviewer cannot see -- the link still works, it just stops being countable --
 * so it is asserted here rather than left to the doc comment.
 *
 * The frontend URL is mocked rather than read from the environment: the real
 * BOT_CONFIG falls back to https://nadeshiko.co only when NADESHIKO_FRONTEND_URL
 * is unset, and a developer who has it set should not see these tests fail.
 */
vi.mock('../../config', () => ({
  BOT_CONFIG: { frontendUrl: 'https://frontend.test' },
}));

const recordLinkEmitted = vi.fn();
vi.mock('../../analytics', () => ({
  recordLinkEmitted: (...args: unknown[]) => recordLinkEmitted(...args),
}));

import {
  homeUrl,
  aboutUrl,
  statsUrl,
  sentenceUrl,
  searchUrl,
  mediaSearchUrl,
  botInstallUrl,
  botGuildInstallUrl,
  DISCORD_INVITE_URL,
} from '../../links';

beforeEach(() => {
  recordLinkEmitted.mockReset();
});

describe('attribution', () => {
  test('every user-facing link carries the utm triple by default', () => {
    const url = new URL(homeUrl());

    expect(url.searchParams.get('utm_source')).toBe('discord');
    expect(url.searchParams.get('utm_medium')).toBe('bot');
    expect(url.searchParams.get('utm_campaign')).toBe('bot');
  });

  test('surface names the campaign, so a link can be traced to the command that emitted it', () => {
    const url = new URL(statsUrl({ surface: 'info' }));

    expect(url.searchParams.get('utm_campaign')).toBe('info');
  });

  test('utm_content names the destination kind, which is what separates two links in one reply', () => {
    expect(new URL(homeUrl()).searchParams.get('utm_content')).toBe('home');
    expect(new URL(aboutUrl()).searchParams.get('utm_content')).toBe('about');
    expect(new URL(statsUrl()).searchParams.get('utm_content')).toBe('stats');
    expect(new URL(sentenceUrl('seg-1')).searchParams.get('utm_content')).toBe('sentence');
  });

  test('opting out returns the bare url -- this is the /health path', () => {
    expect(homeUrl({ attribution: false })).toBe('https://frontend.test');
  });

  test('an opted-out link is not counted, or the denominator would include the bot fetching itself', () => {
    homeUrl({ attribution: false });

    expect(recordLinkEmitted).not.toHaveBeenCalled();
  });

  test('an attributed link is counted once, with the target and surface it was emitted under', () => {
    sentenceUrl('seg-1', { surface: 'search' });

    expect(recordLinkEmitted).toHaveBeenCalledTimes(1);
    expect(recordLinkEmitted).toHaveBeenCalledWith({ target: 'sentence', surface: 'search' });
  });
});

describe('sentenceUrl', () => {
  test('addresses the segment by public id', () => {
    expect(new URL(sentenceUrl('seg-abc')).pathname).toBe('/sentence/seg-abc');
  });
});

describe('searchUrl', () => {
  test('a bare search has no filter params', () => {
    const url = new URL(searchUrl());

    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('media')).toBeNull();
    expect(url.searchParams.get('episode')).toBeNull();
    expect(url.searchParams.get('utm_content')).toBe('search');
  });

  test('the query rides in the path, encoded', () => {
    expect(new URL(searchUrl({ query: '食べたい' })).pathname).toBe(`/search/${encodeURIComponent('食べたい')}`);
    expect(new URL(searchUrl({ query: 'spy family' })).pathname).toBe('/search/spy%20family');
  });

  test('a media filter reports itself as a media link', () => {
    const url = new URL(searchUrl({ query: 'x', mediaPublicId: 'media-1' }));

    expect(url.searchParams.get('media')).toBe('media-1');
    expect(url.searchParams.get('utm_content')).toBe('media');
  });

  test('episodes are comma-joined and outrank media as the reported target', () => {
    const url = new URL(searchUrl({ mediaPublicId: 'media-1', episodes: [1, 2, 3] }));

    expect(url.searchParams.get('episode')).toBe('1,2,3');
    expect(url.searchParams.get('media')).toBe('media-1');
    expect(url.searchParams.get('utm_content')).toBe('episode');
  });

  test('an empty episode list is not a filter', () => {
    const url = new URL(searchUrl({ mediaPublicId: 'media-1', episodes: [] }));

    expect(url.searchParams.get('episode')).toBeNull();
    expect(url.searchParams.get('utm_content')).toBe('media');
  });
});

describe('mediaSearchUrl', () => {
  test('without an episode it filters to the media alone', () => {
    const url = new URL(mediaSearchUrl('media-1'));

    expect(url.searchParams.get('media')).toBe('media-1');
    expect(url.searchParams.get('episode')).toBeNull();
  });

  test('episode 0 is a real episode, not an absent one', () => {
    // `episode == null` is the guard in mediaSearchUrl; a falsy check here would
    // silently drop episode 0.
    expect(new URL(mediaSearchUrl('media-1', 0)).searchParams.get('episode')).toBe('0');
  });

  test('with an episode it filters to that one episode', () => {
    expect(new URL(mediaSearchUrl('media-1', 7)).searchParams.get('episode')).toBe('7');
  });
});

describe('links that leave Discord for Discord', () => {
  test('the invite matches the canonical code the frontend sync test guards', () => {
    expect(DISCORD_INVITE_URL).toBe('https://discord.gg/qRak9MprUS');
  });

  test('the invite is not attributed -- there is no Nadeshiko pageview at the far end', () => {
    expect(DISCORD_INVITE_URL).not.toContain('utm_');
    expect(recordLinkEmitted).not.toHaveBeenCalled();
  });

  test('the install link is bare, so Discord offers both installation contexts', () => {
    const url = botInstallUrl('app-1');

    // Naming a scope collapses the chooser back to the server-only path, which
    // is the gate the bare link exists to remove.
    expect(url).toBe('https://discord.com/oauth2/authorize?client_id=app-1');
    expect(url).not.toContain('scope=');
  });

  test('the admin variant names the permission set so an owner can see what they grant', () => {
    const url = new URL(botGuildInstallUrl('app-1', '3072'));

    expect(url.searchParams.get('client_id')).toBe('app-1');
    expect(url.searchParams.get('permissions')).toBe('3072');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
  });
});
