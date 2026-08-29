import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
// Importing the mocks registers them; it has to come before the command handlers.
import {
  resetApiMocks,
  mockGetStats,
  mockFetchRandom,
  mockSearch,
  mockGetSearchStats,
  mockDownloadFile,
} from '../mocks/api';

import { execute as executeStats } from '../../commands/stats';
import { execute as executeInfo } from '../../commands/info';
import { execute as executeHealth } from '../../commands/health';
import { execute as executeRandom } from '../../commands/random';
import { FlowRunner } from '../harness/flow';
import { makeSegment, makeMedia, makeSearchResponse, makeSearchStatsResponse } from '../mocks/fixtures';
import type { StatsResponse } from '../../api';

/**
 * The four commands that were shipping with nothing exercising them. Each one
 * has exactly one thing worth protecting, and none of it is the happy path:
 *
 * - `/stats` and `/health` do arithmetic and division on numbers that come from
 *   the backend, including zeroes.
 * - `/info` splices an application id into an install URL.
 * - `/random` decides which language setting wins.
 */
function makeStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    totalSegments: 1_234_567,
    totalEpisodes: 8_900,
    totalMedia: 450,
    totalFrequencyWords: 216_000,
    dialogueHours: 3_400,
    lastUpdated: '2026-08-01T00:00:00.000Z',
    tiers: [
      { tier: 1000, covered: 980, total: 1000, percentage: 98 },
      { tier: 999999999, covered: 100_000, total: 216_000, percentage: 46 },
    ],
    translations: { total: 1_234_567, enHuman: 750_000, enMachine: 250_000, esHuman: 200_000, esMachine: 600_000 },
    ...overrides,
  } as StatsResponse;
}

beforeEach(() => {
  resetApiMocks();
});

describe('/stats', () => {
  test('renders the corpus totals with thousands separators', async () => {
    mockGetStats.mockResolvedValue(makeStats());
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeStats, {}, 'stats');

    const corpus = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Corpus').value;
    expect(corpus).toContain('1,234,567');
    expect(corpus).toContain('450');
  });

  test('reports the human share of each translation language', async () => {
    mockGetStats.mockResolvedValue(makeStats());
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeStats, {}, 'stats');

    const translations = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Translations').value;
    // 750k human of 1M total EN, 200k human of 800k total ES.
    expect(translations).toContain('75% human');
    expect(translations).toContain('25% human');
  });

  test('does not render NaN when a language has no translations at all', async () => {
    // `enHuman / enTotal` is 0/0 for a language nobody has translated yet --
    // a new locale on day one. `NaN% human` is what users would see.
    mockGetStats.mockResolvedValue(
      makeStats({ translations: { total: 0, enHuman: 0, enMachine: 0, esHuman: 0, esMachine: 0 } }),
    );
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeStats, {}, 'stats');

    const translations = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Translations').value;
    expect(translations).not.toContain('NaN');
  });

  test('draws a progress bar of a fixed width for every tier', async () => {
    // The bar sits in a code block where a ragged width is immediately visible.
    mockGetStats.mockResolvedValue(makeStats());
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeStats, {}, 'stats');

    const coverage = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Word Coverage').value;
    for (const line of coverage.split('\n').filter((l: string) => l.includes('█') || l.includes('░'))) {
      const bar = line.match(/[█░]+/)[0];
      expect(bar).toHaveLength(10);
    }
  });

  test('names the sentinel tier as the full corpus rather than printing 999999999', async () => {
    mockGetStats.mockResolvedValue(makeStats());
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeStats, {}, 'stats');

    const coverage = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Word Coverage').value;
    expect(coverage).toContain('Full corpus');
    expect(coverage).not.toContain('999,999,999');
  });

  test('replies with an error message when the API is down, rather than leaving the reply spinning', async () => {
    // A deferred reply that is never edited shows "the application did not
    // respond" after three seconds and tells the user nothing.
    mockGetStats.mockRejectedValue(new Error('backend down'));
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeStats, {}, 'stats');

    expect(result.content).toContain('Something went wrong');
  });
});

describe('/info', () => {
  test('builds the install button from the running application’s own id', async () => {
    // Hard-coding the id, or reading it from the wrong place, produces a link
    // that installs a different bot -- or nothing.
    const flow = new FlowRunner({ applicationId: 'app-42' });

    await flow.executeCommand(executeInfo, {}, 'info');

    const buttons = flow.getCapture().lastOfArgs(['reply']).components[0].toJSON().components;
    const install = buttons.find((b: { label: string }) => b.label === 'Add to Discord');
    expect(install.url).toContain('app-42');
  });

  test('offers the homepage, about, Patreon and install links', async () => {
    const flow = new FlowRunner();

    await flow.executeCommand(executeInfo, {}, 'info');

    const buttons = flow.getCapture().lastOfArgs(['reply']).components[0].toJSON().components;
    expect(buttons.map((b: { label: string }) => b.label)).toEqual(['Homepage', 'About', 'Patreon', 'Add to Discord']);
  });

  test('every button is a link button with a URL Discord will accept', async () => {
    // Discord rejects the whole message if a link button has no URL, so /info
    // would fail outright rather than degrade.
    const flow = new FlowRunner();

    await flow.executeCommand(executeInfo, {}, 'info');

    const buttons = flow.getCapture().lastOfArgs(['reply']).components[0].toJSON().components;
    for (const button of buttons) {
      expect(() => new URL(button.url)).not.toThrow();
    }
  });
});

describe('/health', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Answers every probe with the given status. */
  function stubFetch(status: number | Error) {
    globalThis.fetch = vi.fn(async () => {
      if (status instanceof Error) throw status;
      return new Response('', { status });
    }) as typeof fetch;
  }

  test('reports healthy when every probe comes back OK', async () => {
    stubFetch(200);
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeHealth, {}, 'health');

    expect(result.embeds[0].title).toContain('healthy');
  });

  test('reports degraded when a single probe fails', async () => {
    stubFetch(503);
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeHealth, {}, 'health');

    expect(result.embeds[0].title).toContain('degraded');
    expect(result.embeds[0].title).not.toContain('healthy');
  });

  test('shows the HTTP status of a failing check, which is what makes it actionable', async () => {
    stubFetch(502);
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeHealth, {}, 'health');

    expect(JSON.stringify(result.embeds[0].fields)).toContain('HTTP 502');
  });

  test('survives a probe that throws instead of answering', async () => {
    // A DNS failure or a refused connection rejects rather than resolving. If
    // that escaped `checkEndpoint`, /health -- the command people run when
    // things are broken -- would be the one that breaks.
    stubFetch(new Error('ECONNREFUSED'));
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeHealth, {}, 'health');

    expect(result.embeds[0].title).toContain('degraded');
  });

  test('reports the bot as starting while the gateway has no ping yet', async () => {
    // discord.js reports -1 before the first heartbeat round-trip. Rendered
    // literally that is "online (-1ms)".
    stubFetch(200);
    const flow = new FlowRunner({ wsPing: -1 });

    const result = await flow.executeCommand(executeHealth, {}, 'health');

    const bot = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Discord Bot').value;
    expect(bot).toContain('starting');
    expect(bot).not.toContain('-1ms');
  });

  test('reports the gateway latency once there is one', async () => {
    stubFetch(200);
    const flow = new FlowRunner({ wsPing: 87 });

    const result = await flow.executeCommand(executeHealth, {}, 'health');

    const bot = result.embeds[0].fields.find((f: { name: string }) => f.name === 'Discord Bot').value;
    expect(bot).toContain('87ms');
  });

  test('probes the frontend without attribution, so /health does not invent Discord referrals', async () => {
    // Tagged as user traffic these probes land in analytics as click-throughs
    // that nobody made, once per /health.
    stubFetch(200);
    const flow = new FlowRunner();

    await flow.executeCommand(executeHealth, {}, 'health');

    const probed = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    for (const url of probed) {
      expect(url).not.toContain('utm_source');
    }
  });
});

describe('/random', () => {
  beforeEach(() => {
    const segment = makeSegment({ publicId: 'seg-1', mediaPublicId: 'media-1' });
    const media = makeMedia({ publicId: 'media-1' });
    const response = makeSearchResponse([segment], { 'media-1': media });
    mockFetchRandom.mockResolvedValue(response);
    mockSearch.mockResolvedValue(response);
    // Random mode fetches corpus stats alongside the draw, to label the reply.
    mockGetSearchStats.mockResolvedValue(makeSearchStatsResponse([], {}));
    mockDownloadFile.mockResolvedValue(Buffer.from('video'));
  });

  test('returns a sentence', async () => {
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeRandom, {}, 'random');

    expect(result.content).toContain('テスト');
  });

  test('an explicit language option overrides the guild default', async () => {
    // The mocked guild setting is `both`; asking for English only must win.
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeRandom, { language: 'en' }, 'random');

    expect(result.content).toContain('**EN');
    expect(result.content).not.toContain('**ES');
  });

  test('falls back to the guild setting when no language is given', async () => {
    const flow = new FlowRunner();

    const result = await flow.executeCommand(executeRandom, {}, 'random');

    expect(result.content).toContain('**EN');
    expect(result.content).toContain('**ES');
  });

  test('a media filter reaches the search call', async () => {
    const flow = new FlowRunner();

    await flow.executeCommand(executeRandom, { media: 'media-7' }, 'random');

    const call = mockFetchRandom.mock.calls.at(-1) ?? mockSearch.mock.calls.at(-1);
    expect(JSON.stringify(call)).toContain('media-7');
  });
});
