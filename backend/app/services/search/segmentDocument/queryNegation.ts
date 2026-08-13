/**
 * Splits leading-`-` exclusions out of a user query so they can be applied once,
 * globally, instead of once per language clause.
 *
 * WHY THIS EXISTS
 * -----------------------------------------------------------------------------
 * buildMultiLanguage returns a `dis_max` — a disjunction — over the Japanese
 * surface, kana, English and Spanish clauses. Handing the raw query to every
 * clause means each one compiles its own `MUST_NOT` against its own tokenization,
 * and because the clauses are OR'd, a clause that does not recognise the excluded
 * form re-admits a document another clause correctly dropped.
 *
 * The kana field tokenizes by reading, so `ズレて` → [ズレ, テ] while `ずれてる`
 * → [ズレ, テル]. The negation misses `テル`, and those documents came back
 * through the kana clause: `"ズレ" -ズレて` still returned `ずれてる`.
 *
 * Hoisting the exclusion above the `dis_max` restores the pre-split behaviour,
 * where the reading field was a sub-field of one multi-field `query_string` and
 * negation therefore spanned every field at once.
 *
 * SEMANTICS
 * -----------------------------------------------------------------------------
 * `A -B` means "documents matching A, minus documents a positive search for B
 * would return". Exclusion mirrors inclusion: the excluded term is run through
 * the same multi-language matcher, so conjugation and script folding behave
 * identically on both sides of the operator, and any future improvement to
 * matching applies to exclusion for free.
 *
 * WHAT IS DELIBERATELY LEFT ALONE
 * -----------------------------------------------------------------------------
 * Anything with explicit boolean syntax — `AND`/`OR`/`NOT`, `!`, `&&`/`||`, or
 * parentheses — is handed to Lucene untouched. Lifting a `-` out of a grouped
 * expression would change what the expression means, and those queries are rare
 * enough that per-clause negation is the safer default. Likewise `exactMatch`,
 * where the whole string is quoted and operators are literal text.
 */

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

  // A query that is nothing but exclusions matches nothing today (Lucene returns
  // no documents for a purely negative query_string). Hoisting would silently
  // turn it into "everything except X" — a product decision, not a bug fix.
  const positive = positives.join(' ');
  if (!positive) return unchanged;

  return { positive, negatives };
}
