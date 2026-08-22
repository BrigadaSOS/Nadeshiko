/**
 * Tests for the generated createNadeshikoClient wrapper behavior.
 *
 * These tests import the built public SDK and use a mock HTTP server
 * to verify flat params, data unwrapping, throwOnError fallback, string shorthand,
 * auto-pagination, custom headers, and error wrapping.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createNadeshikoClient, NadeshikoError } from '../generated/internal';

let server: Server;
let baseURL: string;

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk: string) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // Search endpoint (POST body-only)
    if (url.pathname === '/v1/search' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const cursor = body.cursor;

      if (!cursor) {
        return jsonResponse(res, {
          segments: [{ id: 1, textJa: { content: 'page1' } }],
          includes: { media: {} },
          pagination: { hasMore: true, cursor: 'cursor-2', estimatedTotalHits: 2 },
        });
      }
      if (cursor === 'cursor-2') {
        return jsonResponse(res, {
          segments: [{ id: 2, textJa: { content: 'page2' } }],
          includes: { media: {} },
          pagination: { hasMore: false, cursor: null, estimatedTotalHits: 2 },
        });
      }
      return jsonResponse(res, { segments: [], includes: { media: {} }, pagination: { hasMore: false, cursor: null, estimatedTotalHits: 0 } });
    }

    // Search stats (POST body-only, echoes custom header + user-agent)
    if (url.pathname === '/v1/search/stats' && req.method === 'POST') {
      const customHeader = req.headers['x-custom-header'] ?? null;
      const userAgent = req.headers['user-agent'] ?? null;
      return jsonResponse(res, {
        categories: [{ category: 'ANIME', count: 42 }],
        media: [],
        _echoHeader: customHeader,
        _echoUserAgent: userAgent,
      });
    }

    // Media by ID (GET path + query)
    if (url.pathname.match(/^\/v1\/media\/[\w-]+$/) && req.method === 'GET') {
      const id = url.pathname.split('/').pop();
      return jsonResponse(res, { publicId: id, nameEn: 'Test Media', episodeCount: 12, segmentCount: 100 });
    }

    // Error fixtures, ahead of the generic segment route below because that one
    // matches any id and would answer 200 for these.
    //
    // A body that is not JSON at all, so nothing can be read off it.
    if (url.pathname === '/v1/media/segments/plaintext-error' && req.method === 'GET') {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('upstream unavailable');
    }

    // A real problem document, for the branch that must keep working unchanged.
    if (url.pathname === '/v1/media/segments/problem-doc' && req.method === 'GET') {
      return jsonResponse(
        res,
        {
          code: 'SEGMENT_NOT_FOUND',
          title: 'Not Found',
          detail: 'Segment not found',
          status: 404,
          instance: 'trace-abc',
        },
        404,
      );
    }

    // Segment by UUID (GET path + query)
    if (url.pathname.match(/^\/v1\/media\/segments\/[\w-]+$/) && req.method === 'GET') {
      const uuid = url.pathname.split('/').pop();
      return jsonResponse(res, { publicId: uuid, textJa: { content: 'test' } });
    }

    // List media (GET query-only, paginated)
    if (url.pathname === '/v1/media' && req.method === 'GET') {
      return jsonResponse(res, {
        media: [{ publicId: 'media-1', nameEn: 'Anime 1' }],
        pagination: { hasMore: false, cursor: null },
        stats: { totalMedia: 1, totalSegments: 100, totalEpisodes: 12 },
      });
    }

    // Get episode (GET path-only with 2 path params)
    if (url.pathname.match(/^\/v1\/media\/[\w-]+\/episodes\/\d+$/) && req.method === 'GET') {
      const parts = url.pathname.split('/');
      return jsonResponse(res, {
        mediaPublicId: parts[3],
        episodeNumber: Number(parts[5]),
        titleEn: 'Test Episode',
      });
    }

    // Delete user (POST body-only, all fields optional). Reports what actually
    // arrived on the wire, so a test can tell "sent {}" from "sent nothing".
    if (url.pathname === '/v1/auth/delete-user' && req.method === 'POST') {
      let raw = '';
      req.setEncoding('utf-8');
      await new Promise<void>((resolve) => {
        req.on('data', (chunk: string) => {
          raw += chunk;
        });
        req.on('end', () => resolve());
      });
      return jsonResponse(res, { success: true, message: 'User deleted', _rawBody: raw });
    }

    // better-auth answers in its OWN shape, not RFC 7807: a string `code` and a
    // `message`, with no `status`, `title` or `detail`. This is the response that
    // used to surface as `NadeshikoError: API error undefined`.
    if (url.pathname === '/v1/auth/list-sessions' && req.method === 'GET') {
      return jsonResponse(res, { code: 'SESSION_NOT_FRESH', message: 'Session is not fresh' }, 403);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  baseURL = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function makeClient(overrides?: Record<string, unknown>) {
  return createNadeshikoClient({
    apiKey: 'test-key',
    baseURL,
    retryOptions: { maxRetries: 0 },
    ...overrides,
  });
}

describe('flat params — body-only endpoints', () => {
  test('search: body fields passed directly at top level', async () => {
    const client = makeClient();
    // Flat: { query: { search: '猫' } } instead of { body: { query: { search: '猫' } } }
    const data = await client.search({ query: { search: '猫' } });

    expect(data.segments).toBeDefined();
    expect(data.segments[0].textJa.content).toBe('page1');
  });

  test('search: returns data directly, not envelope', async () => {
    const client = makeClient();
    const data = await client.search({ query: { search: '猫' } });

    expect((data as any).response).toBeUndefined();
    expect((data as any).request).toBeUndefined();
  });
});

describe('flat params — query-only endpoints', () => {
  test('listMedia: query fields passed directly at top level', async () => {
    const client = makeClient();
    // Flat: { query: 'naruto' } instead of { query: { query: 'naruto' } }
    const data = await client.listMedia({ query: 'naruto', category: 'ANIME' });

    expect(data.media).toBeDefined();
    expect(data.media[0].nameEn).toBe('Anime 1');
  });
});

describe('flat params — path-and-query endpoints', () => {
  test('getMedia: path + query fields merged at top level', async () => {
    const client = makeClient();
    // Flat: { mediaPublicId: 'test-id' } instead of { path: { mediaPublicId: 'test-id' } }
    const data = await client.getMedia({ mediaPublicId: 'test-id' });

    expect(data.publicId).toBe('test-id');
  });

  test('getEpisode: multiple path params at top level', async () => {
    const client = makeClient();
    // Flat: { mediaPublicId: 'abc', episodeNumber: 5 } instead of { path: { mediaPublicId: 'abc', episodeNumber: 5 } }
    const data = await client.getEpisode({ mediaPublicId: 'abc', episodeNumber: 5 });

    expect(data.mediaPublicId).toBe('abc');
    expect(data.episodeNumber).toBe(5);
  });
});

describe('string shorthand', () => {
  test('getMedia accepts string ID', async () => {
    const client = makeClient();
    const data = await client.getMedia('test-media-id');

    expect(data.publicId).toBe('test-media-id');
  });

  test('getSegment accepts string UUID', async () => {
    const client = makeClient();
    const data = await client.getSegment('test-uuid');

    expect(data.publicId).toBe('test-uuid');
  });
});

describe('throwOnError: false', () => {
  test('returns full envelope when throwOnError: false', async () => {
    const client = makeClient();
    const result = await client.search({
      throwOnError: false,
      query: { search: '猫' },
    });

    if ('error' in result) {
      throw new Error('expected data, got error');
    }
    expect(result.data).toBeDefined();
    expect(result.data.segments).toBeDefined();
    expect(result.response).toBeDefined();
  });
});

describe('auto-pagination', () => {
  test('search.paginate yields items across pages', async () => {
    const client = makeClient();
    const items: any[] = [];

    // Flat params: { query: { search: '猫' } } instead of { body: { query: { search: '猫' } } }
    for await (const segment of client.search.paginate({
      query: { search: '猫' },
    })) {
      items.push(segment);
    }

    expect(items).toHaveLength(2);
    expect(items[0].textJa.content).toBe('page1');
    expect(items[1].textJa.content).toBe('page2');
  });

  test('listMedia.paginate yields items', async () => {
    const client = makeClient();
    const items: any[] = [];

    for await (const media of client.listMedia.paginate()) {
      items.push(media);
    }

    expect(items).toHaveLength(1);
    expect(items[0].nameEn).toBe('Anime 1');
  });
});

describe('custom headers', () => {
  test('sends configured headers with requests', async () => {
    const client = makeClient({
      headers: { 'X-Custom-Header': 'test-value' },
    });

    const data = await client.getSearchStats({
      query: { search: 'test' },
    });

    expect((data as any)._echoHeader).toBe('test-value');
  });

  test('sends default User-Agent header', async () => {
    const client = makeClient();

    const data = await client.getSearchStats({
      query: { search: 'test' },
    });

    expect((data as any)._echoUserAgent).toMatch(/^nadeshiko-sdk-ts\/\d+\.\d+\.\d+/);
  });

  test('user-provided User-Agent overrides default', async () => {
    const client = makeClient({
      headers: { 'User-Agent': 'MyApp/1.0' },
    });

    const data = await client.getSearchStats({
      query: { search: 'test' },
    });

    expect((data as any)._echoUserAgent).toBe('MyApp/1.0');
  });
});

describe('error handling', () => {
  test('NadeshikoError has correct fields', () => {
    const err = new NadeshikoError({
      code: 'VALIDATION_FAILED',
      title: 'Bad Request',
      detail: 'field is required',
      status: 400,
      instance: 'trace-123',
      errors: { name: 'is required' },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NadeshikoError);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.status).toBe(400);
    expect(err.traceId).toBe('trace-123');
    expect(err.errors).toEqual({ name: 'is required' });
    expect(err.message).toBe('field is required');
    expect(err.name).toBe('NadeshikoError');
  });

  test('NadeshikoError with UNKNOWN_ERROR code', () => {
    const err = new NadeshikoError({
      code: 'UNKNOWN_ERROR' as any,
      title: 'Unexpected error',
      detail: 'Bad Gateway',
      status: 502,
    });

    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.status).toBe(502);
  });

  // The message must never render a missing field as the literal "undefined":
  // `API error undefined` was a real production issue that named neither the
  // failure nor the endpoint, so it could not be acted on.
  test('a body with no status never produces "API error undefined"', () => {
    const err = new NadeshikoError({ code: 'UNKNOWN_ERROR' as any } as any);

    expect(err.message).toBe('API error with no status');
    expect(err.message).not.toContain('undefined');
  });

  test('a non-RFC7807 body keeps its own code and message', async () => {
    const client = makeClient();

    // better-auth's `{ code, message }` shape. It has a string `code`, which is
    // what the old guard matched on before checking for a numeric `status`.
    const err = await client.listUserSessions().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NadeshikoError);
    expect((err as NadeshikoError).message).toBe('Session is not fresh');
    expect((err as NadeshikoError).code).toBe('SESSION_NOT_FRESH');
    expect((err as NadeshikoError).status).toBe(403);
    expect((err as NadeshikoError).requestUrl).toContain('/v1/auth/list-sessions');
  });

  test('a non-JSON body still carries the transport status', async () => {
    const client = makeClient();
    const err = await client
      .getSegment({ segmentPublicId: 'plaintext-error' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NadeshikoError);
    expect((err as NadeshikoError).status).toBe(503);
    expect((err as NadeshikoError).code).toBe('UNKNOWN_ERROR');
    expect((err as NadeshikoError).message).not.toContain('undefined');
  });

  test('a real problem document is still used verbatim, plus the request URL', async () => {
    const client = makeClient();
    const err = await client
      .getSegment({ segmentPublicId: 'problem-doc' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NadeshikoError);
    expect((err as NadeshikoError).message).toBe('Segment not found');
    expect((err as NadeshikoError).code).toBe('SEGMENT_NOT_FOUND');
    expect((err as NadeshikoError).status).toBe(404);
    expect((err as NadeshikoError).traceId).toBe('trace-abc');
    expect((err as NadeshikoError).requestUrl).toContain('/v1/media/segments/problem-doc');
  });

  // The query string is dropped so that search terms do not reach error tracking
  // and one fault does not fingerprint into an issue per distinct URL.
  test('requestUrl excludes the query string', async () => {
    const client = makeClient();
    const err = await client
      .getSegment({ segmentPublicId: 'problem-doc', include: ['media'] } as any)
      .catch((e: unknown) => e);

    expect((err as NadeshikoError).requestUrl).not.toContain('?');
  });
});

describe('body-only endpoints with no fields', () => {
  /**
   * Nadeshiko#521. The wrapper used to omit `body` entirely when the caller
   * passed no fields, which sends a POST with no request body at all -- and a
   * server that validates the body then sees `undefined` rather than `{}`.
   * Measured against the real auth surface on 2026-08-22:
   *
   *   POST /v1/auth/delete-user  (no body) -> 400 "[body] Invalid input:
   *                                            expected object, received undefined"
   *   POST /v1/auth/delete-user  {}        -> 401, i.e. past validation
   *
   * So `deleteAccount()` on the settings page could never reach the auth check.
   * The endpoint's fields are all optional; the body itself is not.
   */
  test('deleteUser({}) still sends a JSON body', async () => {
    const client = makeClient();
    const result = (await client.deleteUser({})) as unknown as { _rawBody: string };

    expect(result._rawBody).toBe('{}');
  });

  test('deleteUser() with no argument at all sends a JSON body too', async () => {
    const client = makeClient();
    const result = (await client.deleteUser()) as unknown as { _rawBody: string };

    expect(result._rawBody).toBe('{}');
  });
});
