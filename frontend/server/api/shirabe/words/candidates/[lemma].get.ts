import { createError, getQuery, getRouterParam, setResponseHeader } from 'h3';
import { logger } from '~~/server/utils/logger';
import { callShirabe, describeFailure } from '~~/server/utils/shirabeCall';
import {
  readerHasOwnStack,
  readerStack,
  readerToken,
  reportShirabeRefusal,
  reportStackFingerprint,
} from '~~/server/utils/shirabeReader';
import { distinctNameAnswers, withoutNameEntries } from '~~/server/utils/shirabeNames';

// Use identify with reading/POS hints: bare-lemma lookup ignores homograph context. Return ranked alternatives
// because the reader may need to choose. Keep browser GET for caching even though the upstream call is POST.

const CACHE_SECONDS = 60 * 60 * 24;
const RETRY_AFTER_SECONDS = 5;

// Clamp label locales to supported values; definitions include all languages and callers select their own.
const LABEL_LOCALES = new Set(['en', 'es']);

interface ShirabeCandidate {
  id: string;
  headword: string;
  // Display label for a matched kana form; identity remains id/headword.
  matchedHeadword?: string | null;
  reading?: string | null;
  common?: boolean;
  // Stable dictionary identity across reimports, paired with dictionary.
  sourceId?: string;
  dictionary?: string;
  // Use Shirabe's name flag; dictionary slugs alone cannot reliably identify names.
  name?: boolean;
  // Resolvable components of a multi-word expression; absent for ordinary words and grammar.
  parts?: unknown[];
  entries?: unknown[];

  pitch?: unknown[];
  furigana?: unknown[];
  forms?: unknown[];
  frequency?: number | null;
  jlpt?: string | null;
}

interface IdentifyResponse {
  // Index-aligned with input tokens; null means no entry, not an upstream failure.
  words: Array<{ candidates: ShirabeCandidate[] } | null>;
  // Echoed dictionary-stack digest lets clients detect stale cached answers.
  stackFingerprint?: string | null;
}

const handler = defineEventHandler(async (event) => {
  const lemma = getRouterParam(event, 'lemma');
  if (!lemma) throw createError({ statusCode: 400, statusMessage: 'lemma is required' });

  const query = getQuery(event);
  const requested = String(query.locale ?? '');
  const locale = LABEL_LOCALES.has(requested) ? requested : 'en';

  // Omit blank hints; unknown differs from an explicit empty value. pos must use Shirabe's short tag, not UniDic:
  // unrecognized categories can return no candidates.
  const token: Record<string, string> = { lemma };
  for (const key of ['surface', 'reading', 'pos'] as const) {
    const value = String(query[key] ?? '').trim();
    if (value) token[key] = value;
  }

  // Fetch a linked reader's key only on a cache miss.
  const reader = await readerStack(event);
  const hasOwnStack = reader.linked;
  const apiKey = hasOwnStack ? ((await readerToken(event)) ?? undefined) : undefined;

  const ask = (key?: string) =>
    // locale belongs in the query: the strict identify body schema accepts tokens, not locale.
    callShirabe<IdentifyResponse>({
      path: '/words/identify',
      method: 'POST',
      query: { locale, ...(key ? {} : { 'dictionaries[]': 'jmdict' }) },
      // Include all card data in one call; parts keeps component words reachable from merged expressions.
      body: {
        tokens: [token],
        include: ['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'notes', 'parts'],
      },
      subject: lemma,
      apiKey: key,
    });

  try {
    let answer: IdentifyResponse;
    // A service fallback must never be reported as the reader's dictionary stack.
    let answeredAsReader = Boolean(apiKey);
    try {
      answer = await ask(apiKey);
    } catch (readerError: unknown) {
      // Only reader-key refusals/rate limits fall back to service dictionaries, not arbitrary upstream failures.
      if (!apiKey) throw readerError;

      const status = (readerError as { response?: { status?: number } })?.response?.status;
      if (status !== 401 && status !== 403 && status !== 429) throw readerError;

      logger.warn({ lemma, status }, 'A reader Shirabe key was refused; answering with the default dictionaries');

      // 401/403 describe the link; 429 only describes usage. Report refusals asynchronously for the next lookup.
      if (status !== 429) void reportShirabeRefusal(event, status);

      answeredAsReader = false;
      answer = await ask();
    }

    // Report changed reader stacks without delaying this fresh answer; the next request uses the updated cache key.
    if (answeredAsReader && answer?.stackFingerprint && answer.stackFingerprint !== reader.fingerprint) {
      void reportStackFingerprint(event, answer.stackFingerprint);
    }

    // No entry is a 200 identify response with a null token; expose it as our own 404.
    const found = answer?.words?.[0];
    // Prefer ordinary words when present; preserve name candidates when they are the only answer.
    const all = found?.candidates ?? [];
    const words = withoutNameEntries(all);
    const candidates = words.length > 0 ? words : all;
    if (!candidates.length) throw createError({ statusCode: 404, statusMessage: 'No entry for this word' });

    // Collapse multiple distinct name glosses, not repeated copies of one useful definition.
    const nameOnly = words.length === 0 && distinctNameAnswers(all) > 1;

    // Linked stacks may include private uploads; only unlinked default answers can be shared-cached.
    setResponseHeader(
      event,
      'cache-control',
      hasOwnStack ? `private, max-age=${CACHE_SECONDS}` : `public, max-age=${CACHE_SECONDS}`,
    );
    // Expose a fingerprint only for actual reader answers; service fingerprints must not re-key shared browser caches.
    return {
      ...found,
      candidates,
      nameOnly,
      ...(answeredAsReader && answer?.stackFingerprint ? { stackFingerprint: answer.stackFingerprint } : {}),
    };
  } catch (error: unknown) {
    // Keep our no-entry 404 separate from upstream failure classification.
    if ((error as { statusCode?: number })?.statusCode === 404) throw error;

    const { kind, status } = describeFailure(error);

    if (kind === 'bad-path') {
      logger.error({ lemma }, 'Shirabe returned an HTML 404 -- the API path is wrong, not the word missing');
      throw createError({ statusCode: 502, statusMessage: 'Dictionary lookup failed' });
    }

    // Identify reports missing tokens in a 200 body; an upstream 404 means the route failed.
    logger.warn({ lemma, status, err: error }, 'Shirabe identify failed');
    // Optional enrichment failures are retryable 503s, not missing words. no-store prevents caching an outage for a day.
    setResponseHeader(event, 'cache-control', 'no-store');
    setResponseHeader(event, 'retry-after', RETRY_AFTER_SECONDS);
    throw createError({ statusCode: 503, statusMessage: 'Dictionary temporarily unavailable' });
  }
});

// Cache only shared default dictionaries; linked readers bypass server caching, including on service fallback.
// Browser-private caching covers repeated linked lookups without risking cross-reader dictionary leakage.
export default defineCachedEventHandler(handler, {
  swr: true,
  maxAge: CACHE_SECONDS,
  shouldBypassCache: readerHasOwnStack,
});
