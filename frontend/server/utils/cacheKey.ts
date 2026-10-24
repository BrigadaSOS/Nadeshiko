import { createHash } from 'node:crypto';

// Nitro's escapeKey strips every non-word character, so raw slugs or Japanese lemmas would collide
// (`k-on` and `kon`, every kanji to ''). Hash the parts into a key that survives escaping intact.
export function stableCacheKey(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
