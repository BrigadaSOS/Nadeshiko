/**
 * Pins the served `Token` schema to the token the parser actually builds.
 *
 * Every response goes through `responseValidationFactory`, which validates with
 * a generated `z.object()` -- and a `z.object()` STRIPS keys it does not
 * declare. So a field can be parsed, stored, documented on `SlimToken` and
 * covered by its own unit test, and still never reach a client, because the one
 * place that had to know about it is a YAML file nobody edits when adding a
 * field to the model.
 *
 * That is not hypothetical. `pt` -- Shirabe's short POS tag, the value
 * `words/identify` ranks by -- was written by `toSlimToken`, backfilled across
 * the whole corpus by a re-tokenization, and silently dropped from every search
 * response for as long as it existed, because `Token.yaml` never grew the
 * property. Nothing failed: the frontend has a fallback that derives the tag
 * from `p`, so the symptom was a field that did nothing rather than an error.
 *
 * Asserting the whole surface rather than `pt` alone, because the next field
 * added to `SlimToken` will forget the same file.
 */
import { describe, it, expect } from 'vitest';
import { s_Token } from '../../generated/schemas';
import type { SlimToken } from '../../app/models/Segment';

/**
 * A token using every field `toSlimToken` can emit, with values shaped like the
 * real ones: `p` is UniDic's category, `pt` is Shirabe's short tag, `posLabel`
 * is the printable wording. Typed as `SlimToken` so dropping a field from the
 * model without dropping it here fails to compile.
 */
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
      expect(served, `\`${key}\` is on SlimToken but not in Token.yaml, so it is stripped from every response`).toHaveProperty(key);
    }
    expect(served).toEqual(FULL_TOKEN);
  });

  /**
   * Called out on its own because it is the field the lookup depends on, and
   * because losing it fails quietly: the client falls back to its own UniDic
   * map, which is right until Shirabe emits a category that map lacks.
   */
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
