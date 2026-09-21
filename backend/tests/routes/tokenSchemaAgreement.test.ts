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
 * An older optional parser field was once stored but never served because it
 * was absent from the schema. Check every current field so that cannot recur.
 */
import { describe, it, expect } from 'vitest';
import { s_Token } from '../../generated/schemas';
import type { SlimToken } from '../../app/models/Segment';

/**
 * A token using every field `toSlimToken` can emit, with values shaped like the
 * real ones. Typed as `SlimToken` so dropping a field from the
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

  it('strips old lookup-only POS fields from a stored token', () => {
    const parsed = s_Token.parse({ ...FULL_TOKEN, pt: 'verb', posLabel: 'Verb' });
    expect(parsed).not.toHaveProperty('pt');
    expect(parsed).not.toHaveProperty('posLabel');
  });
});
