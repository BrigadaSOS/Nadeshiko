import { describe, expect, it } from 'vitest';
import { presentsBypassSecret } from './rateLimitBypass';

const SECRET = 'PxK2s9Qw4mVb7Ld1Rt6Yz0Nh3Jf8Ac5';

describe('presentsBypassSecret', () => {
  // The state production is in. No parameter is set there and deploy.prod.yml
  // does not carry the variable, so the door has to not exist rather than be
  // openable with an empty string.
  it('refuses everything when no secret is configured', () => {
    expect(presentsBypassSecret(SECRET, '')).toBe(false);
    expect(presentsBypassSecret('', '')).toBe(false);
    expect(presentsBypassSecret(undefined, '')).toBe(false);
  });

  it('lets the configured secret through', () => {
    expect(presentsBypassSecret(SECRET, SECRET)).toBe(true);
  });

  it('refuses a header that is absent, empty, or merely close', () => {
    expect(presentsBypassSecret(undefined, SECRET)).toBe(false);
    expect(presentsBypassSecret('', SECRET)).toBe(false);
    expect(presentsBypassSecret(`${SECRET} `, SECRET)).toBe(false);
    expect(presentsBypassSecret(SECRET.slice(0, -1), SECRET)).toBe(false);
    // Same length, one byte out -- the case an early-return comparison would
    // answer fastest and so leak first.
    expect(presentsBypassSecret(`${SECRET.slice(0, -1)}X`, SECRET)).toBe(false);
  });

  it('is not fooled by a prefix of the right length', () => {
    expect(presentsBypassSecret('P'.repeat(SECRET.length), SECRET)).toBe(false);
  });
});
