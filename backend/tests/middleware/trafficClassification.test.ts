import { describe, it, expect } from 'vitest';
import type { Application, Request } from 'express';
import { TRAFFIC_HEADER, BOT_FAMILY_HEADER } from '@lib/traffic';
import { request } from '../helpers/http';
import { buildApplication } from '@config/application';
import { config } from '@config/config';

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Built through buildApplication so the classifier sits where production puts
// it: ahead of the rate limiter, so `req.traffic` is already decided by the
// time anything can reject the request. The echo route reports what the
// middleware attached.
function buildApp(): Application {
  return buildApplication({
    rateLimit: false,
    mountRoutes: (app) => {
      app.get('/echo', (req: Request, res) => {
        res.json({ traffic: req.traffic, botFamily: req.botFamily ?? null });
      });
    },
  });
}

describe('trafficClassification', () => {
  it('labels a browser as reader', async () => {
    const res = await request(buildApp()).get('/echo').set('User-Agent', CHROME);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ traffic: 'reader', botFamily: null });
  });

  it('labels a crawler as bot and names the family', async () => {
    const res = await request(buildApp()).get('/echo').set('User-Agent', GOOGLEBOT);
    expect(res.body).toEqual({ traffic: 'bot', botFamily: 'googlebot' });
  });

  it('labels our own uptime probes as monitor, not reader', async () => {
    const res = await request(buildApp()).get('/echo').set('User-Agent', 'Gatus/5.12.0');
    expect(res.body).toEqual({ traffic: 'monitor', botFamily: null });
  });

  describe('classification forwarded by the frontend', () => {
    // SSR fetches a page's data over the internal network without the visitor's
    // User-Agent, so the frontend has to tell us who it is rendering for. That
    // claim is only worth as much as the secret proving it came from us.
    //
    // Not guarded on the secret being present: .env.test is committed with one
    // and preflight loads it over .env, so an unset secret means the test
    // environment regressed and should fail loudly rather than skip quietly.
    const secret = config.INTERNAL_PROXY_SECRET;

    it('is trusted when the internal-proxy secret is presented', async () => {
      const res = await request(buildApp())
        .get('/echo')
        .set('x-internal-proxy-auth', String(secret))
        .set(TRAFFIC_HEADER, 'bot')
        .set(BOT_FAMILY_HEADER, 'gptbot');
      expect(res.body).toEqual({ traffic: 'bot', botFamily: 'gptbot' });
    });

    it('rejects a family name that would inflate metric cardinality', async () => {
      const res = await request(buildApp())
        .get('/echo')
        .set('x-internal-proxy-auth', String(secret))
        .set(TRAFFIC_HEADER, 'bot')
        .set(BOT_FAMILY_HEADER, 'session-4f3c-9d21-not-a-family-name-and-far-too-long-to-be-one');
      expect(res.body).toEqual({ traffic: 'bot', botFamily: null });
    });

    it('is ignored without the secret, falling back to the presented User-Agent', async () => {
      const res = await request(buildApp())
        .get('/echo')
        .set('User-Agent', CHROME)
        .set(TRAFFIC_HEADER, 'monitor')
        .set(BOT_FAMILY_HEADER, 'gptbot');
      expect(res.body).toEqual({ traffic: 'reader', botFamily: null });
    });
  });
});
