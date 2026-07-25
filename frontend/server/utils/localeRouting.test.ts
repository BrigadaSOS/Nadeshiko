import { describe, expect, it } from 'vitest';
import { isReservedLocalePath } from './localeRouting';

describe('isReservedLocalePath', () => {
  it('keeps Nuxt internal error rendering outside locale redirects', () => {
    expect(isReservedLocalePath('/__nuxt_error')).toBe(true);
  });

  it('does not reserve user-facing content paths', () => {
    expect(isReservedLocalePath('/about')).toBe(false);
    expect(isReservedLocalePath('/blog/example')).toBe(false);
  });
});
