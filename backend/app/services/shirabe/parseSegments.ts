import { config } from '@config/config';
import { logger } from '@config/log';
import type { SlimToken } from '@app/models/Segment';

/**
 * Shirabe parses our Japanese. This is the only place that talks to it, and the
 * only place that knows how its answer becomes one of our tokens.
 *
 * Both paths through the corpus come here: the one-time backfill of everything
 * we already have, and every new episode as it lands. That is the point of it
 * being one function. A second implementation of this mapping (a Ruby task on
 * their side, say) would be a second thing to keep in step with our published
 * `Token`, and the two would drift on the first field either of us added.
 *
 * What Shirabe returns is its own shape, built for a reader: a `tokens` array
 * per input with positions and grouping, plus a deduplicated `vocabulary` pool
 * that each token points into by index. What we store is the ten short fields
 * our OpenAPI publishes. `toSlimToken` is that translation.
 */

const PARSE_BATCH = 200; // measured sweet spot: throughput falls off past this
const TIMEOUT_MS = 30_000;

/**
 * How many parse batches are in flight at once.
 *
 * The batch SIZE is already tuned (see above); what was left on the table is
 * that batches ran strictly one after another, so a corpus reparse spent ~90% of
 * its time waiting on a round trip and moved at ~95 segments/s while using 13% of
 * the character budget and 6% of the request budget.
 *
 * Deliberately a small number rather than "as many as the limits allow". Shirabe
 * serves readers from the same box, and the published limits are a ceiling, not a
 * target: a bulk job that saturates them stops being a background job. Three puts
 * a full corpus pass comfortably under half the character budget.
 *
 * `SHIRABE_PARSE_CONCURRENCY` exists so a one-off migration can be nudged without
 * a deploy, and so it can be pinned back to 1 if Shirabe is having a bad day.
 */
const PARSE_CONCURRENCY = Math.max(1, Number(process.env.SHIRABE_PARSE_CONCURRENCY ?? 3) || 3);

/** One token as Shirabe serves it. Narrowed to what the mapping reads. */
interface ShirabeToken {
  position: number;
  length: number;
  surface: string;
  lemma?: string;
  reading?: string;
  posFull?: string[];
  posLabel?: string;
  kind?: string;
  vocabIndex?: number;
  furigana?: Array<{ text: string; ruby?: string }>;
  inflection?: { labels: string[]; base: string };
  components?: Array<{ surface: string; offset: number; length: number }>;
}

interface ShirabeParseResponse {
  tokens: ShirabeToken[][];
  vocabulary: Array<{ lemma: string; reading?: string; id?: string }>;
}

/**
 * "*" is Sudachi for "this slot does not apply" and 一般 is the slot declining to
 * say anything more specific. Neither is a value, and our own schema types these
 * four as nullable with `minLength: 1`, so passing either through would break it.
 */
function meaningful(value: string | undefined): string | undefined {
  if (!value || value === '*' || value === '一般') return undefined;
  return value;
}

function toSlimToken(token: ShirabeToken, wid: string | undefined): SlimToken {
  const pos = token.posFull ?? [];
  const slim: SlimToken = {
    s: token.surface,
    d: token.lemma || token.surface,
    // Sudachi reads a symbol as itself (。 reads 。) and `r` is a required
    // string, so the surface stands in where there is no reading to give.
    r: token.reading || token.surface,
    b: token.position,
    e: token.position + token.length,
    p: pos[0] ?? '',
  };

  const p1 = meaningful(pos[1]);
  const p2 = meaningful(pos[2]);
  const p4 = meaningful(pos[4]);
  const cf = meaningful(pos[5]);
  if (p1) slim.p1 = p1;
  if (p2) slim.p2 = p2;
  if (p4) slim.p4 = p4;
  if (cf) slim.cf = cf;

  if (token.kind) slim.kind = token.kind;
  if (token.posLabel) slim.posLabel = token.posLabel;
  if (wid) slim.wid = wid;
  if (token.furigana?.length) slim.f = token.furigana.map((seg) => ({ t: seg.text, r: seg.ruby }));
  if (token.inflection) slim.inflection = token.inflection;

  // Shirabe groups more coarsely than a morpheme: 食べました is one token where a
  // raw analyzer gives 食べ + まし + た. Elasticsearch highlights with its own
  // analyzer, so a match can land inside one of ours, and these are the
  // boundaries that let that render as a partial highlight.
  if (token.components?.length) {
    slim.parts = token.components.map((part) => ({
      s: part.surface,
      b: token.position + part.offset,
      e: token.position + part.offset + part.length,
    }));
  }

  return slim;
}

/**
 * Parse a batch of Japanese sentences. Answers one token array per input, in
 * input order, so a caller can zip it back against whatever it sent.
 *
 * A sentence with no Japanese in it (a music cue, "( laughs )") comes back as an
 * empty array rather than an error: that is a real answer about a real segment.
 */
export async function parseSegments(texts: string[]): Promise<SlimToken[][]> {
  if (texts.length === 0) return [];
  if (!config.SHIRABE_API_KEY) throw new Error('SHIRABE_API_KEY is not set: nothing can be parsed without it');

  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += PARSE_BATCH) {
    chunks.push(texts.slice(i, i + PARSE_BATCH));
  }

  // Results are placed by chunk index, not appended, so concurrency cannot
  // reorder them: the contract is one token array per input, in input order.
  const results: SlimToken[][][] = new Array(chunks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const chunk = chunks[index];
      if (!chunk) return;
      results[index] = await parseChunk(chunk);
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, chunks.length) }, worker));

  return results.flat();
}

/** One request to Shirabe, mapped into our token shape. */
async function parseChunk(chunk: string[]): Promise<SlimToken[][]> {
  const response = await fetch(`${config.SHIRABE_API_BASE.replace(/\/$/, '')}/v1/parse`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.SHIRABE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ texts: chunk }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({ status: response.status, body: body.slice(0, 500) }, 'Shirabe parse failed');
    throw new Error(`Shirabe parse failed: ${response.status}`);
  }

  const parsed = (await response.json()) as ShirabeParseResponse;
  return parsed.tokens.map((tokens) =>
    tokens.map((token) =>
      toSlimToken(
        token,
        // The word id lives on the pool rather than the token, because it is
        // a property of the word and a sentence can say it twice.
        token.vocabIndex === undefined ? undefined : parsed.vocabulary[token.vocabIndex]?.id,
      ),
    ),
  );
}

export const __testing = { toSlimToken, PARSE_BATCH, PARSE_CONCURRENCY };
