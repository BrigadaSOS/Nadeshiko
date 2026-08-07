import { describe, expect, it } from 'vitest';
import { botFamily, classifyTraffic, isBot, parseTrafficHeader, trafficAttributes } from '@lib/traffic';

/**
 * The classifier itself is tested once, here. The frontend runs a byte-identical
 * copy of the same logic (frontend/shared/utils/traffic.ts), and
 * traffic.sync.test.ts over there is what guarantees the two stay identical —
 * so duplicating these cases would only mean maintaining them twice.
 */

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('classifyTraffic', () => {
  it('reads a browser as a reader', () => {
    expect(classifyTraffic(CHROME)).toBe('reader');
    expect(classifyTraffic(SAFARI_IOS)).toBe('reader');
  });

  it('reads a crawler as a bot', () => {
    expect(classifyTraffic('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('bot');
  });

  it('reads our own probes as monitors, not bots', () => {
    expect(classifyTraffic('kamal-proxy')).toBe('monitor');
    expect(classifyTraffic('Gatus/5.12.0')).toBe('monitor');
    expect(classifyTraffic('nadeshiko-monitor')).toBe('monitor');
  });

  it('answers reader for a blank User-Agent', () => {
    // Documented in lib/traffic.ts: a wrong "bot" hides load, a vague "reader"
    // only fails to attribute it. Internal calls with no UA must not read as bots.
    expect(classifyTraffic('')).toBe('reader');
    expect(classifyTraffic(undefined)).toBe('reader');
    expect(classifyTraffic(null)).toBe('reader');
  });
});

describe('botFamily', () => {
  it('names the AI crawlers', () => {
    const cases: Array<[string, string]> = [
      [
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
        'gptbot',
      ],
      ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'claudebot'],
      ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'perplexitybot'],
      ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)', 'bytespider'],
      ['Mozilla/5.0 (compatible; CCBot/2.0; +https://commoncrawl.org/faq/)', 'ccbot'],
      [
        'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
        'meta-externalagent',
      ],
    ];
    for (const [agent, family] of cases) {
      expect(botFamily(agent), agent).toBe(family);
    }
  });

  it('prefers the longer family name where one is a prefix of another', () => {
    expect(botFamily('Mozilla/5.0 (compatible; Applebot-Extended/0.1; +http://www.apple.com/go/applebot)')).toBe(
      'applebot-extended',
    );
    expect(botFamily('Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)')).toBe('applebot');
  });

  it('names link-preview fetchers, which are a signal rather than noise', () => {
    expect(botFamily('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)')).toBe('discordbot');
    expect(botFamily('facebookexternalhit/1.1')).toBe('facebookexternalhit');
  });

  it('normalises a spaced family name into one token', () => {
    expect(botFamily('Screaming Frog SEO Spider/21.4')).toBe('screaming-frog');
  });

  it('falls back to "other" for the unnamed long tail', () => {
    expect(botFamily('MysteryBot/1.0')).toBe('other');
    expect(botFamily('python-requests/2.32.3')).toBe('other');
    expect(botFamily('curl/8.7.1')).toBe('other');
    expect(botFamily('Some Unnamed Crawler v3')).toBe('other');
  });

  it('does not mistake a person for a robot', () => {
    // The Yandex Search app is a browser; only the named Yandex robots count.
    expect(
      botFamily(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) YandexSearch/70.00 YandexSearchBrowser/70.00',
      ),
    ).toBeNull();
    // ...and CUBOT is a phone, which is why the generic pattern is \bbot\b.
    expect(
      botFamily(
        'Mozilla/5.0 (Linux; Android 11; CUBOT_NOTE_20) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.101 Mobile Safari/537.36',
      ),
    ).toBeNull();
    expect(botFamily(CHROME)).toBeNull();
  });

  it('answers null for monitors, which are accounted for by classifyTraffic', () => {
    expect(botFamily('kamal-proxy')).toBeNull();
    expect(classifyTraffic('kamal-proxy')).toBe('monitor');
  });

  it('agrees with isBot', () => {
    expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true);
    expect(isBot(CHROME)).toBe(false);
  });
});

describe('propagation helpers', () => {
  it('accepts only the three known values', () => {
    expect(parseTrafficHeader('bot')).toBe('bot');
    expect(parseTrafficHeader('reader')).toBe('reader');
    expect(parseTrafficHeader('monitor')).toBe('monitor');
    expect(parseTrafficHeader('robot')).toBeNull();
    expect(parseTrafficHeader(undefined)).toBeNull();
  });

  it('omits bot.family when there is no crawler', () => {
    expect(trafficAttributes('reader')).toEqual({ traffic: 'reader' });
    expect(trafficAttributes('bot', 'gptbot')).toEqual({ traffic: 'bot', 'bot.family': 'gptbot' });
    expect(trafficAttributes('bot', null)).toEqual({ traffic: 'bot' });
  });
});
