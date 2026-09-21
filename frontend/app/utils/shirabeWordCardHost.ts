import {
  candidateHost,
  type CardEvent,
  type CardToken,
  type Definition,
  type WordCardHost,
} from '@shirabe-org/card/word-card';
import { selectDefinitions, type GlossPreference } from '~/utils/wordCard';
import { fetchWordAt, type WordLookup, type WordLookupTarget } from '~/utils/wordLookup';
import type { EnrichedToken } from '~/utils/tokenEnrichment';

type LookupWord = (target: WordLookupTarget, locale: string) => Promise<WordLookup>;

export interface NadeshikoWordCardHostOptions {
  glossPreference: () => GlossPreference;
  uiLocale?: () => string;
  shirabeSite: string;
  linked?: () => boolean;
  dictionaryReveal?: () => Readonly<Record<string, 'show' | 'hover'>>;
  lookupWordAt?: LookupWord;
  onDefinition?: (definition: Definition | null) => void;
  lookupLinks?: (definition: Definition | null, word: HTMLElement) => Array<{ id: string; label: string; url: string }>;
  report?: (event: CardEvent, detail?: Record<string, string | number | boolean>) => void;
}

export function toShirabeCardToken(token: EnrichedToken): CardToken {
  return {
    surface: token.s,
    start: token.b,
    length: token.e - token.b,
    inflection: token.inflection?.labels,
    inflectionBase: token.inflection?.base,
    content: token.kind !== 'symbol' && token.kind !== 'whitespace',
  };
}

/** Shirabe accepts at most 200 UTF-16 code units per positioned lookup. */
function boundedTarget(text: string, startOffset: number, endOffset: number | undefined): WordLookupTarget {
  if (text.length <= 200) return { text, startOffset, endOffset };
  const targetEnd = endOffset ?? startOffset + 1;
  const targetLength = targetEnd - startOffset;
  if (targetLength > 200) {
    const clipped = text.slice(startOffset, startOffset + 200);
    return { text: clipped, startOffset: 0, endOffset: clipped.length };
  }
  const windowStart = Math.max(0, Math.min(startOffset - Math.floor((200 - targetLength) / 2), text.length - 200));
  return {
    text: text.slice(windowStart, windowStart + 200),
    startOffset: startOffset - windowStart,
    endOffset: endOffset === undefined ? undefined : endOffset - windowStart,
  };
}

export function createNadeshikoWordCardHost(options: NadeshikoWordCardHostOptions): WordCardHost {
  const lookupWordAt = options.lookupWordAt ?? fetchWordAt;
  const site = options.shirabeSite.replace(/\/$/, '');
  return candidateHost({
    site,
    languages: () =>
      [...options.glossPreference().order, ...options.glossPreference().fallback].map((code) =>
        code === 'es' ? ('spa' as const) : ('eng' as const),
      ),
    displayLocale: () => (options.uiLocale?.() === 'es' ? 'es' : 'en'),
    dictionaryReveal: options.dictionaryReveal,
    filterDefinitions: (definitions) =>
      options.linked?.()
        ? definitions
        : selectDefinitions(definitions, {
            ...options.glossPreference(),
            order: [...options.glossPreference().order, ...options.glossPreference().fallback],
            fallback: [],
          }),
    wordUrl: (candidate) => `${site}/${options.glossPreference().labels}/word/${encodeURIComponent(candidate.id)}`,
    onDefinition: options.onDefinition,
    lookupLinks: options.lookupLinks,
    report: options.report,
    lookupCandidates(query, locale) {
      const target: WordLookupTarget =
        typeof query.text === 'string' &&
        typeof query.startOffset === 'number' &&
        Number.isInteger(query.startOffset) &&
        query.startOffset >= 0 &&
        query.startOffset < query.text.length
          ? boundedTarget(query.text, query.startOffset, query.endOffset)
          : { text: query.surface, startOffset: 0, endOffset: query.surface.length };
      return lookupWordAt(target, locale);
    },
  });
}
