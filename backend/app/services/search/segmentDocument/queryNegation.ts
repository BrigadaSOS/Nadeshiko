/** Hoist leading-`-` terms above the language `dis_max` so one language clause cannot re-admit a document another
 * excludes; leave explicit boolean syntax alone. */

export interface SplitQuery {
  /** The query with negated tokens removed; empty when every token was negated. */
  positive: string;
  /** Negated terms, quotes preserved so phrase exclusions stay phrases. */
  negatives: string[];
}

/** Explicit boolean syntax whose meaning depends on where the `-` sits. */
const BOOLEAN_SYNTAX = /[()!]|\|\||&&|(?:^|\s)(?:AND|OR|NOT)(?:\s|$)/;

/** Splits on whitespace, treating a double-quoted run as one token. */
function tokenize(query: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of query) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  // An unbalanced quote is a malformed query; leave it for Lucene to reject and
  // for the safe-parser fallback to retry rather than guessing where it closed.
  return inQuotes ? null : tokens;
}

export function splitNegatedTerms(query: string, exactMatch: boolean): SplitQuery {
  const unchanged: SplitQuery = { positive: query, negatives: [] };

  if (exactMatch || BOOLEAN_SYNTAX.test(query)) return unchanged;

  const tokens = tokenize(query);
  if (!tokens) return unchanged;

  const positives: string[] = [];
  const negatives: string[] = [];

  for (const token of tokens) {
    // `-` only negates at the start of a token, so `well-known` stays one word.
    if (token.length > 1 && token.startsWith('-')) {
      const term = token.slice(1);
      // A bare `-""` carries no term to exclude.
      if (term.replaceAll('"', '').trim()) negatives.push(term);
    } else {
      positives.push(token);
    }
  }

  if (negatives.length === 0) return unchanged;

  // Keep all-negative queries unchanged: hoisting would change “matches nothing” into “everything except X,” which is a
  // product change.
  const positive = positives.join(' ');
  if (!positive) return unchanged;

  return { positive, negatives };
}
