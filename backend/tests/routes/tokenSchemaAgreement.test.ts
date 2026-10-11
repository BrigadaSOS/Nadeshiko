/** Keep the served `Token` schema aligned with `toSlimToken`. Response validation uses `z.object()`, which strips
 * undeclared fields; a YAML omission can therefore drop a parsed field silently. */
import { describe, it, expect } from 'vitest';
import { s_Token } from '../../generated/schemas';
import type { SlimToken } from '../../app/models/Segment';

/** Use every field emitted by `toSlimToken`, with realistic values, and type the fixture as `SlimToken` so
 * model/schema drift fails to compile. */
const FULL_TOKEN: Required<Omit<SlimToken, 'parts' | 'f' | 'inflection'>> &
  Pick<SlimToken, 'parts' | 'f' | 'inflection'> = {
  s: '食べました',
  d: '食べる',
  r: 'タベマシタ',
  b: 3,
  e: 8,
  p: '動詞',
  pt: 'verb',
  posLabel: 'Verb',
  kind: 'inflected',
  f: [{ t: '食', r: 'た' }, { t: 'べました' }],
  inflection: { labels: ['past', 'polite'], base: '食べる' },
  parts: [{ s: '食べ', b: 3, e: 5 }],
};

describe('the served Token schema', () => {
  it('keeps every field the parser puts on a token', () => {
    const served = s_Token.parse(FULL_TOKEN);

    // Key-by-key rather than a single toEqual, so a failure names the field
    // that got stripped instead of printing two large objects.
    for (const key of Object.keys(FULL_TOKEN) as Array<keyof typeof FULL_TOKEN>) {
      expect(
        served,
        `\`${key}\` is on SlimToken but not in Token.yaml, so it is stripped from every response`,
      ).toHaveProperty(key);
    }
    expect(served).toEqual(FULL_TOKEN);
  });

  /** Keep `pt` separate because the lookup depends on it and the client fallback fails quietly for categories its
   * own map lacks. */
  it('serves `pt`, which is what the dictionary lookup ranks by', () => {
    expect(s_Token.parse(FULL_TOKEN).pt).toBe('verb');
  });

  /** Absent on anything parsed before `pt` was stored, so it cannot be required. */
  it('still accepts a token parsed before `pt` existed', () => {
    const { pt: _pt, ...legacy } = FULL_TOKEN;
    expect(() => s_Token.parse(legacy)).not.toThrow();
    expect(s_Token.parse(legacy)).not.toHaveProperty('pt');
  });
});
