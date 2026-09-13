import { beforeEach, describe, expect, test, vi } from 'vitest';

type FakeEvent = {
  url: URL;
  cookies: Record<string, string>;
  responseHeaders: Record<string, string>;
};

let redirects: Array<{ location: string; status: number }> = [];

vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('getRequestURL', (event: FakeEvent) => event.url);
vi.stubGlobal('getCookie', (event: FakeEvent, name: string) => event.cookies[name]);
vi.stubGlobal('setHeader', (event: FakeEvent, name: string, value: string) => {
  event.responseHeaders[name.toLowerCase()] = value;
});
vi.stubGlobal('sendRedirect', (_event: FakeEvent, location: string, status: number) => {
  redirects.push({ location, status });
});

const handler = (await import('./00-locale-router')).default as (event: FakeEvent) => unknown;

function visit(path: string) {
  const event: FakeEvent = {
    url: new URL(`https://nadeshiko.co${path}`),
    cookies: {},
    responseHeaders: {},
  };
  handler(event);
  return redirects[0] ?? null;
}

describe('locale router', () => {
  beforeEach(() => {
    redirects = [];
  });

  test('does not redirect the canonical compact Chinese slug', () => {
    expect(visit('/zh/search/学校')).toBeNull();
  });

  test('does not reinterpret an unsupported locale tag as an English path', () => {
    expect(visit('/zh-CN/about')).toBeNull();
  });
});
