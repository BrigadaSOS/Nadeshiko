/**
 * Finds the knee of the search-render path: how many server-side renders a
 * second the origin serves before latency runs away, and what it does past
 * that point -- which, since 2026-08-31, should be a fast 503 from the
 * admission gate rather than a 30-second 504.
 *
 * A k6 script (https://k6.io). k6 is not installed on developer machines, so run
 * it from the image:
 *
 *   docker run --rm -i -e BASE_URL -e BYPASS_SECRET -e CI_SECRET \
 *     grafana/k6 run - < scripts/loadtest/search-renders.js
 *
 *   BASE_URL       https://stg.nadeshiko.co (default) or https://nadeshiko.co
 *   BYPASS_SECRET  NUXT_RATE_LIMIT_BYPASS_SECRET of the target, so the per-IP
 *                  HTML limiter (60/min) and the render gate's CI carve-out do
 *                  not shape the result. STAGING ONLY -- production deliberately
 *                  has no bypass, so a production run from one address measures
 *                  the limiter, not the box.
 *   CI_SECRET      the Cloudflare WAF skip header, or the JS challenge on
 *                  /search/ answers every request with a 403 at the edge.
 *
 * READ THE RESULT WITH THE HOST IN MIND. Staging shares the box with
 * production, so this is a load test OF THAT MACHINE either way: run it at a
 * quiet hour, watch node_load1 and the frontend container's CPU while it runs,
 * and stop it the moment production latency moves. It ramps to well past the
 * measured ceiling on purpose; the last stages exist to show the 503s, not to
 * find more capacity.
 *
 * Every request is a different term, because a crawler's are: a fixed set would
 * measure the media cache and Cloudflare, not the render.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'https://stg.nadeshiko.co';
const BYPASS_SECRET = __ENV.BYPASS_SECRET || '';
const CI_SECRET = __ENV.CI_SECRET || '';

const rendered = new Counter('renders_ok');
const shed = new Counter('renders_shed_503');
const timedOut = new Counter('renders_timeout_504');
const renderTime = new Trend('render_time_ms', true);

// Common enough to return results, numerous enough to be new every time.
const KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
function term() {
  let out = '';
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) out += KANA[Math.floor(Math.random() * KANA.length)];
  return out;
}

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: 2, duration: '1m' }, // human peak is ~0.7/s
        { target: 5, duration: '2m' }, // below the single-process ceiling (~6.4/s)
        { target: 10, duration: '2m' }, // the two-worker ceiling
        { target: 20, duration: '2m' }, // past it: the gate should be shedding
        { target: 40, duration: '1m' }, // 2026-08-30 shape
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: {
    // Past the knee the right answer is a 503 in milliseconds, never a 504 in
    // thirty seconds. A single 504 means the gate is not doing its job.
    renders_timeout_504: ['count==0'],
    'render_time_ms{status:200}': ['p(95)<3000'],
    'render_time_ms{status:503}': ['p(95)<200'],
  },
};

export default function () {
  const headers = {
    Accept: 'text/html',
    'User-Agent': 'nadeshiko-loadtest/1 (k6; scripts/loadtest/search-renders.js)',
  };
  if (BYPASS_SECRET) headers['x-rate-limit-bypass'] = BYPASS_SECRET;
  if (CI_SECRET) headers['x-nadeshiko-ci'] = CI_SECRET;

  const res = http.get(`${BASE_URL}/en/search/${encodeURIComponent(term())}`, {
    headers,
    timeout: '35s',
    tags: { name: 'search-render' },
  });

  renderTime.add(res.timings.duration, { status: String(res.status) });
  if (res.status === 200) rendered.add(1);
  else if (res.status === 503) shed.add(1);
  else if (res.status === 504) timedOut.add(1);

  check(res, {
    'served or shed, never timed out': (r) => r.status === 200 || r.status === 503,
    'a 503 carries Retry-After': (r) => r.status !== 503 || r.headers['Retry-After'] !== undefined,
  });

  sleep(0.1);
}
