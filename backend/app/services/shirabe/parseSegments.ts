import { config } from '@config/config';
import { logger } from '@config/log';
import type { SlimToken } from '@app/models/Segment';

/** One parser owns Shirabe calls, batching, and input-ordered responses for workers and backfills; it maps one
 * published token shape. */

const PARSE_BATCH = 200; // measured sweet spot: throughput falls off past this
const TIMEOUT_MS = 30_000;

/** Limit parse concurrency so background work leaves capacity for readers; expose the setting to tune or disable
 * parallelism during an incident. */
const PARSE_CONCURRENCY = config.SHIRABE_PARSE_CONCURRENCY;

/** Retry only transient parse failures (429, 5xx, timeout, socket); retrying 400/401 just repeats bad input or
 * credentials. */
const RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;

/** Keep adaptive concurrency at module scope so each small page contributes to one latency signal and the limiter
 * can yield when Shirabe slows. */
const SLOWDOWN_FACTOR = 2.5;
const RECOVER_AFTER_FAST_CHUNKS = 10;

let floorMsPerText = Number.POSITIVE_INFINITY;
let inFlightLimit = PARSE_CONCURRENCY;
let fastChunks = 0;

/** Slots in flight. Workers wait here rather than the pool being resized. */
let active = 0;
const waiting: Array<() => void> = [];

async function takeSlot(): Promise<void> {
  // Re-checked after every wake: the limit can fall while a worker is parked, and
  // a waiter that trusted its wake-up would overshoot the new limit.
  while (active >= inFlightLimit) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
}

function releaseSlot(): void {
  active -= 1;
  // Wake everyone and let them re-check. At a ceiling of three this is cheaper
  // than tracking who is allowed to run, and it cannot strand a waiter.
  waiting.splice(0).forEach((wake) => {
    wake();
  });
}

/** Feed one chunk's timing back into the limit. Exported for tests. */
function recordChunkTiming(elapsedMs: number, texts: number): void {
  const perText = elapsedMs / Math.max(1, texts);
  if (perText < floorMsPerText) floorMsPerText = perText;

  if (perText > floorMsPerText * SLOWDOWN_FACTOR) {
    if (inFlightLimit !== 1) {
      logger.warn(
        { perText, floorMsPerText, from: inFlightLimit },
        'Shirabe is slowing down; parsing one chunk at a time',
      );
    }
    inFlightLimit = 1;
    fastChunks = 0;
    return;
  }

  fastChunks += 1;
  if (fastChunks >= RECOVER_AFTER_FAST_CHUNKS && inFlightLimit < PARSE_CONCURRENCY) {
    inFlightLimit += 1;
    fastChunks = 0;
  }
}

/** Whether a failed attempt is worth repeating. */
function isTransient(status: number | null): boolean {
  if (status === null) return true; // timeout, reset socket, DNS -- no response at all
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One token as Shirabe serves it. Narrowed to what the mapping reads. */
interface ShirabeToken {
  position: number;
  length: number;
  surface: string;
  lemma?: string;
  reading?: string;
  posFull?: string[];
  posLabel?: string;
  /** Store Shirabe's short POS tag separately from UniDic's full category and the display label; lookup ranking uses
   * the short tag. */
  pos?: string;
  kind?: string;
  furigana?: Array<{ text: string; ruby?: string }>;
  inflection?: { labels: string[]; base: string };
  components?: Array<{ surface: string; offset: number; length: number }>;
}

interface ShirabeParseResponse {
  tokens: ShirabeToken[][];
}

function toSlimToken(token: ShirabeToken): SlimToken {
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

  if (token.kind) slim.kind = token.kind;
  if (token.posLabel) slim.posLabel = token.posLabel;
  // Persist the POS tag used by `words/identify`; keep it optional for pre-reparse corpus rows so the legacy derivation
  // remains available.
  if (token.pos) slim.pt = token.pos;
  if (token.furigana?.length) slim.f = token.furigana.map((seg) => ({ t: seg.text, r: seg.ruby }));
  if (token.inflection) slim.inflection = token.inflection;

  // Keep Shirabe component boundaries because Elasticsearch highlights can land inside one coarse token.
  if (token.components?.length) {
    slim.parts = token.components.map((part) => ({
      s: part.surface,
      b: token.position + part.offset,
      e: token.position + part.offset + part.length,
    }));
  }

  return slim;
}

/** Return one token array per input in input order; a Japanese-free sentence is a valid empty result, not a batch
 * error. */
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

      await takeSlot();
      const startedAt = Date.now();
      try {
        results[index] = await parseChunk(chunk);
      } finally {
        releaseSlot();
      }
      recordChunkTiming(Date.now() - startedAt, chunk.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, chunks.length) }, worker));

  return results.flat();
}

/**
 * One request to Shirabe, mapped into our token shape, retried while the failure
 * still looks like something that will pass.
 */
async function parseChunk(chunk: string[]): Promise<SlimToken[][]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await requestChunk(chunk);
    } catch (error) {
      lastError = error;
      const status = error instanceof ShirabeParseError ? error.status : null;
      if (!isTransient(status) || attempt === RETRY_ATTEMPTS) throw error;

      // Exponential, capped. `Retry-After` wins when Shirabe sends one: it is the
      // server saying how long it needs, which beats anything guessed here.
      const backoff =
        error instanceof ShirabeParseError && error.retryAfterMs !== null
          ? error.retryAfterMs
          : Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
      logger.warn({ status, attempt, backoff }, 'Shirabe parse failed; retrying');
      await sleep(backoff);
    }
  }

  throw lastError;
}

class ShirabeParseError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`Shirabe parse failed: ${status}`);
    this.name = 'ShirabeParseError';
  }
}

async function requestChunk(chunk: string[]): Promise<SlimToken[][]> {
  // Use `/api/v1`, not `/v1`: Shirabe mounts its Rails API under `/api`, so the shorter path returns an HTML 404.
  const response = await fetch(`${config.SHIRABE_API_BASE.replace(/\/$/, '')}/api/v1/parse`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.SHIRABE_API_KEY}`,
      'content-type': 'application/json',
    },
    // Request `posFull` and `posLabel` explicitly; omitting `include` succeeds but silently writes tokens without the
    // morphology this index needs.
    body: JSON.stringify({ texts: chunk, include: ['posFull', 'posLabel'] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({ status: response.status, body: body.slice(0, 500) }, 'Shirabe parse failed');
    const retryAfter = Number(response.headers.get('retry-after'));
    throw new ShirabeParseError(
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    );
  }

  const parsed = (await response.json()) as ShirabeParseResponse;
  // Do not request dictionary word ids: they are expensive and dictionary-derived, while stored morphology remains
  // stable enough to resolve words live.
  return parsed.tokens.map((tokens) => tokens.map((token) => toSlimToken(token)));
}

export const __testing = {
  toSlimToken,
  PARSE_BATCH,
  PARSE_CONCURRENCY,
  RETRY_ATTEMPTS,
  recordChunkTiming,
  isTransient,
  inFlightLimit: () => inFlightLimit,
  /** The adaptive state outlives a call on purpose; a test has to clear it. */
  resetPacing: () => {
    floorMsPerText = Number.POSITIVE_INFINITY;
    inFlightLimit = PARSE_CONCURRENCY;
    fastChunks = 0;
    active = 0;
    waiting.splice(0).forEach((wake) => {
      wake();
    });
  },
};
