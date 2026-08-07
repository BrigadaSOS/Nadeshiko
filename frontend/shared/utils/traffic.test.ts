import { describe, expect, it } from 'vitest';
import { resolveEventTraffic, trafficHeaders } from './traffic';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot';

function eventWith(userAgent?: string, context: Record<string, unknown> = {}) {
  return { context, node: { req: { headers: userAgent ? { 'user-agent': userAgent } : {} } } };
}

describe('resolveEventTraffic', () => {
  it('classifies from the visitor User-Agent', () => {
    expect(resolveEventTraffic(eventWith(CHROME))).toEqual({ traffic: 'reader', family: null });
    expect(resolveEventTraffic(eventWith(GPTBOT))).toEqual({ traffic: 'bot', family: 'gptbot' });
  });

  it('memoises onto the event context so later readers pay nothing', () => {
    const event = eventWith(GPTBOT);
    const first = resolveEventTraffic(event);
    expect(event.context.traffic).toBe(first);

    // Mutating the header afterwards must not change the answer: every emitter
    // on one request has to agree, and the first classification is the record.
    event.node.req.headers = { 'user-agent': CHROME };
    expect(resolveEventTraffic(event)).toBe(first);
  });

  it('falls back to reader when there is no event at all', () => {
    expect(resolveEventTraffic(undefined)).toEqual({ traffic: 'reader', family: null });
    expect(resolveEventTraffic(null)).toEqual({ traffic: 'reader', family: null });
  });
});

describe('trafficHeaders', () => {
  it('carries the classification, and the family only when there is one', () => {
    expect(trafficHeaders(eventWith(GPTBOT))).toEqual({
      'x-nadeshiko-traffic': 'bot',
      'x-nadeshiko-bot-family': 'gptbot',
    });
    expect(trafficHeaders(eventWith(CHROME))).toEqual({ 'x-nadeshiko-traffic': 'reader' });
  });
});
