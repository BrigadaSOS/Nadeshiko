import { describe, expect, it } from 'vitest';
import { isServerOnlyProxyRoute } from './serverOnlyProxyRoute';

describe('isServerOnlyProxyRoute', () => {
  const credential = '/v1/user/connections/shirabe/credential';

  it.each([
    ['GET', credential],
    ['get', `${credential}/`],
    ['HEAD', `${credential}//`],
    ['HEAD', '/v1/user/connections/shirabe/CREDENTIAL/'],
  ])('refuses the Express-equivalent %s %s spelling', (method, path) => {
    expect(isServerOnlyProxyRoute(method, path)).toBe(true);
  });

  it('does not turn a prefix or another method into a denylisted route', () => {
    expect(isServerOnlyProxyRoute('GET', `${credential}/extra`)).toBe(false);
    expect(isServerOnlyProxyRoute('POST', credential)).toBe(false);
  });
});
