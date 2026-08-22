import { describe, it, expect } from 'vitest';
import { trafficOfRender } from '../useRequestTraffic';

const eventFor = (userAgent?: string) => ({
  context: {} as Record<string, unknown>,
  node: { req: { headers: userAgent ? { 'user-agent': userAgent } : {} } },
});

describe('trafficOfRender', () => {
  it('names a search crawler', () => {
    expect(trafficOfRender(eventFor('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'))).toBe(
      'bot',
    );
  });

  it('names an AI crawler', () => {
    expect(trafficOfRender(eventFor('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)'))).toBe('bot');
  });

  it('treats a browser as a reader', () => {
    expect(
      trafficOfRender(
        eventFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140'),
      ),
    ).toBe('reader');
  });

  it('treats a missing event as a reader, which is what the client render is', () => {
    expect(trafficOfRender(null)).toBe('reader');
  });
});
