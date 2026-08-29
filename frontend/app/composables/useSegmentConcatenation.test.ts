import { describe, test, expect, beforeEach, vi } from 'vitest';
import { effectScope, ref } from 'vue';

/**
 * Expanding a sentence into its neighbours.
 *
 * The pure text-merging half already has tests (`utils/segmentConcatenation`).
 * What was untested is the ORCHESTRATION, and it is where every real bug in this
 * feature has been, because each one is a wrong ordering rather than a wrong
 * value:
 *
 * - The revert happens LATE, after every branch that could make the expansion a
 *   no-op. Reverting up front -- as this once did -- meant an "expand left" at
 *   the start of an episode silently threw away the expansion already on screen.
 * - A blob URL must be revoked on every path that abandons it: reverted,
 *   disposed, or superseded while its audio was still being built. Each leak is
 *   a WAV held for the life of the tab, and none of them is visible.
 * - The text swap is NOT held back for the audio, and an audio failure has to
 *   say so out loud -- the text on screen has grown, but an Anki export is about
 *   to attach the original clip, and shipping a card with the wrong audio is
 *   worse than the expansion failing outright.
 */
const sdk = { getSegmentContext: vi.fn() };
const player = { releaseIfSource: vi.fn(), retimeCurrentClip: vi.fn() };
const posthog = { capture: vi.fn() };
const toasts = { error: vi.fn(), info: vi.fn() };
const revokeObjectURL = vi.fn();

const concatenateAudios = vi.fn();
const reportError = vi.fn();

// The composable IMPORTS these three by name, so a global stub would not be
// seen; only `concatenateAudios` and the `use*` helpers below arrive through
// Nuxt's auto-imports.
vi.mock('~/stores/player', () => ({ usePlayerStore: () => player }));
vi.mock('~/utils/toast', () => ({
  useToastError: (...a: unknown[]) => toasts.error(...a),
  useToastInfo: (...a: unknown[]) => toasts.info(...a),
  useToastSuccess: vi.fn(),
}));
vi.mock('~/utils/reportError', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
  reportEvent: vi.fn(),
}));

vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('usePostHog', () => posthog);
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useContentRating', () => ({ contentRating: ref(['SAFE']) }));
vi.stubGlobal('concatenateAudios', (...a: unknown[]) => concatenateAudios(...a));
vi.stubGlobal('window', { URL: { revokeObjectURL, createObjectURL: () => 'blob:new' } });

import { useSegmentConcatenation } from './useSegmentConcatenation';

/** One segment as the API returns it, numbered so a merge is readable. */
function segment(n: number, overrides: Record<string, unknown> = {}) {
  return {
    publicId: `seg-${n}`,
    position: n,
    episode: 1,
    startTimeMs: n * 1000,
    endTimeMs: n * 1000 + 900,
    textJa: { content: `文${n}`, tokens: [] },
    textEn: { content: `en${n}` },
    textEs: { content: `es${n}` },
    urls: { audioUrl: `https://cdn.test/seg-${n}.mp3` },
    ...overrides,
  };
}

/** The card the reader is looking at. */
function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    media: { publicId: 'media-1', category: 'ANIME' },
    segment: segment(2),
    blobAudio: null as unknown,
    blobAudioUrl: null as string | null,
    expandedWindow: null as unknown,
    ...overrides,
  };
}

/**
 * A context response in the SDK's own shape -- flat segments plus a media map --
 * because `resolveContextResponse` is what turns it into search results, and
 * handing it the already-resolved shape would skip the code under test.
 */
function contextOf(segments: ReturnType<typeof segment>[]) {
  return {
    segments: segments.map((s) => ({ ...s, mediaPublicId: 'media-1' })),
    includes: { media: { 'media-1': { publicId: 'media-1', category: 'ANIME' } } },
  };
}

/** Runs the composable inside a scope, so `onScopeDispose` can be triggered. */
function withComposable() {
  const scope = effectScope();
  const api = scope.run(() => useSegmentConcatenation())!;
  return { ...api, dispose: () => scope.stop() };
}

beforeEach(() => {
  vi.clearAllMocks();
  concatenateAudios.mockResolvedValue({ blob_url: 'blob:expanded', blob: {}, cacheBypassed: false });
});

describe('expanding', () => {
  test('merges the neighbour’s text into the card', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(result.segment.textJa.content).toContain('文1');
    expect(result.segment.textJa.content).toContain('文3');
  });

  test('grows the clip window with the text, without waiting on the audio', async () => {
    // A YouTube clip is streamed from a window rather than assembled from
    // objects, so it must grow the moment the text does.
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(result.expandedWindow).toEqual({ startMs: 1000, endMs: 3900 });
    expect(player.retimeCurrentClip).toHaveBeenCalledWith(result);
  });

  test('attaches the built audio to the card', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(result.blobAudioUrl).toBe('blob:expanded');
  });

  test('records the expansion with how many segments it merged', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(posthog.capture).toHaveBeenCalledWith(
      'segment_expand_completed',
      expect.objectContaining({ outcome: 'expanded', segments_merged: 3, audio: 'built' }),
    );
  });

  test('marks the card as the expanded one', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment, isConcatenated, concatenatedResult } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(isConcatenated(result as never)).toBe(true);
    expect(concatenatedResult.value).toBe(result);
  });

  test('clears the in-flight flag when it is done', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment, isConcatenating } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(isConcatenating.value).toBe(false);
  });
});

describe('when there is nothing to expand into', () => {
  test('says so instead of appearing to do nothing', async () => {
    // Previously a bare `return`, which is exactly what made the menu item look
    // dead at the start and end of an episode.
    const result = makeResult({ segment: segment(1) });
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(toasts.info).toHaveBeenCalled();
  });

  test('records the boundary, so "nobody expands" and "nothing to expand into" are tellable apart', async () => {
    const result = makeResult({ segment: segment(1) });
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(posthog.capture).toHaveBeenCalledWith(
      'segment_expand_completed',
      expect.objectContaining({ outcome: 'boundary' }),
    );
  });

  test('KEEPS the expansion already on screen', async () => {
    // The bug this exists for: the revert used to happen up front, so an
    // "expand left" at the start of an episode silently threw away the
    // expansion the reader was already looking at.
    const first = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment, isConcatenated } = withComposable();
    await loadNextSegment(first as never, 'both', false);
    const expandedText = first.segment.textJa.content;

    const atBoundary = makeResult({ segment: segment(1) });
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1)]));
    await loadNextSegment(atBoundary as never, 'both', false);

    expect(first.segment.textJa.content).toBe(expandedText);
    expect(isConcatenated(first as never)).toBe(true);
  });

  test('still expands the side that does exist, and says which half it got', async () => {
    // One side of an "expand both" missing is not a failure.
    const result = makeResult({ segment: segment(1) });
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(result.segment.textJa.content).toContain('文2');
    expect(toasts.info).toHaveBeenCalled();
  });
});

describe('reverting', () => {
  /** Expands `result` and hands back a way to undo it. */
  async function expanded() {
    const result = makeResult();
    const original = result.segment.textJa.content;
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const api = withComposable();
    await api.loadNextSegment(result as never, 'both', false);
    return { result, original, ...api };
  }

  test('puts the original text back', async () => {
    const { result, original, revertActiveConcatenation } = await expanded();

    revertActiveConcatenation();

    expect(result.segment.textJa.content).toBe(original);
  });

  test('releases the blob url the expansion allocated', async () => {
    // Otherwise a WAV is held for the life of the tab, once per expansion.
    const { revertActiveConcatenation } = await expanded();

    revertActiveConcatenation();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:expanded');
  });

  test('makes the player let go BEFORE the url stops resolving', async () => {
    // The other order leaves the media element pointing at a dead address.
    const order: string[] = [];
    player.releaseIfSource.mockImplementation(() => order.push('release'));
    revokeObjectURL.mockImplementation(() => order.push('revoke'));
    const { revertActiveConcatenation } = await expanded();

    revertActiveConcatenation();

    expect(order).toEqual(['release', 'revoke']);
  });

  test('shrinks the clip window back and tells the player', async () => {
    const { result, revertActiveConcatenation } = await expanded();

    revertActiveConcatenation();

    expect(result.expandedWindow).toBeNull();
    expect(player.retimeCurrentClip).toHaveBeenLastCalledWith(result);
  });

  test('forgets the expansion, so the card is no longer marked', async () => {
    const { result, revertActiveConcatenation, isConcatenated, concatenatedResult } = await expanded();

    revertActiveConcatenation();

    expect(isConcatenated(result as never)).toBe(false);
    expect(concatenatedResult.value).toBeNull();
  });

  test('is safe to call when nothing is expanded', async () => {
    const { revertActiveConcatenation } = withComposable();

    expect(() => revertActiveConcatenation()).not.toThrow();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  test('expanding a second card reverts the first', async () => {
    const { result: first, original, loadNextSegment } = await expanded();

    const second = makeResult({ segment: segment(5) });
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(4), segment(5), segment(6)]));
    await loadNextSegment(second as never, 'both', false);

    expect(first.segment.textJa.content).toBe(original);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:expanded');
  });

  test('snapshots the ORIGINAL text, not the last expansion’s', async () => {
    // Snapshotting before the revert would store the already-expanded text, and
    // the card could never get back to what the segment actually says.
    const result = makeResult();
    const original = result.segment.textJa.content;
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment, revertActiveConcatenation } = withComposable();

    await loadNextSegment(result as never, 'both', false);
    await loadNextSegment(result as never, 'both', false);
    revertActiveConcatenation();

    expect(result.segment.textJa.content).toBe(original);
  });
});

describe('when the audio cannot be built', () => {
  beforeEach(() => {
    concatenateAudios.mockRejectedValue(new TypeError('Failed to fetch'));
  });

  test('the text still expands -- it is the half that can be produced at once', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(result.segment.textJa.content).toContain('文1');
  });

  test('says so, because an export is about to attach the wrong clip', async () => {
    // Silently shipping a card whose audio does not match its text is worse
    // than the expansion having failed outright.
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(toasts.error).toHaveBeenCalledWith('segment.expandAudioFailed');
  });

  test('a streamed YouTube clip gets the shorter message', async () => {
    // Its playback comes from a clip window rather than these objects, so it
    // expanded regardless and only the export is affected. Saying otherwise
    // sends the reader looking for a playback fault that is not there.
    const result = makeResult({
      media: { publicId: 'media-1', category: 'YOUTUBE' },
      segment: segment(2, { externalVideoId: 'vid-1' }),
    });
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(toasts.error).toHaveBeenCalledWith('segment.expandAudioFailedStreamed');
  });

  test('records that the audio failed while the expansion succeeded', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(posthog.capture).toHaveBeenCalledWith(
      'segment_expand_completed',
      expect.objectContaining({ outcome: 'expanded', audio: 'failed' }),
    );
  });

  test('leaves the expand controls usable', async () => {
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment, isConcatenating } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(isConcatenating.value).toBe(false);
  });
});

describe('when the context request fails', () => {
  test('tells the reader and reports it', async () => {
    sdk.getSegmentContext.mockRejectedValue(new Error('offline'));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(makeResult() as never, 'both', false);

    expect(toasts.error).toHaveBeenCalledWith('segment.expandFailed');
    expect(reportError).toHaveBeenCalledWith('segment:expansion-failed', expect.anything(), expect.anything());
  });

  test('records the failure', async () => {
    sdk.getSegmentContext.mockRejectedValue(new Error('offline'));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(makeResult() as never, 'both', false);

    expect(posthog.capture).toHaveBeenCalledWith(
      'segment_expand_completed',
      expect.objectContaining({ outcome: 'context-failed' }),
    );
  });

  test('leaves the card untouched when it failed before the swap', async () => {
    const result = makeResult();
    const original = result.segment.textJa.content;
    sdk.getSegmentContext.mockRejectedValue(new Error('offline'));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(result as never, 'both', false);

    expect(result.segment.textJa.content).toBe(original);
  });

  test('a response the segment is not in is reported as unplaceable', async () => {
    // Distinct from a boundary: the request worked and came back without the
    // segment being expanded, which is a different fault entirely.
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(7), segment(8)]));
    const { loadNextSegment } = withComposable();

    await loadNextSegment(makeResult() as never, 'both', false);

    expect(posthog.capture).toHaveBeenCalledWith(
      'segment_expand_completed',
      expect.objectContaining({ outcome: 'unplaceable' }),
    );
    expect(toasts.error).toHaveBeenCalledWith('segment.expandFailed');
  });
});

describe('concurrency and disposal', () => {
  test('a second expansion started mid-flight is dropped', async () => {
    // Two in flight would revert the first while its audio was still building,
    // stranding the WAV blob URL.
    let release: (value: unknown) => void = () => {};
    sdk.getSegmentContext.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { loadNextSegment, isConcatenating } = withComposable();

    const first = loadNextSegment(makeResult() as never, 'both', false);
    expect(isConcatenating.value).toBe(true);
    await loadNextSegment(makeResult() as never, 'both', false);

    expect(sdk.getSegmentContext).toHaveBeenCalledTimes(1);
    release(contextOf([segment(1), segment(2), segment(3)]));
    await first;
  });

  test('a caller that says it is already loading is dropped too', async () => {
    const { loadNextSegment } = withComposable();

    await loadNextSegment(makeResult() as never, 'both', true);

    expect(sdk.getSegmentContext).not.toHaveBeenCalled();
  });

  test('audio that lands after disposal is revoked rather than attached', async () => {
    // Attaching would put expanded audio on a card nothing renders, and there
    // would be no revert left to release it.
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    let releaseAudio: (value: unknown) => void = () => {};
    concatenateAudios.mockReturnValue(new Promise((resolve) => (releaseAudio = resolve)));
    const { loadNextSegment, dispose } = withComposable();

    const pending = loadNextSegment(result as never, 'both', false);
    await Promise.resolve();
    dispose();
    releaseAudio({ blob_url: 'blob:late', blob: {}, cacheBypassed: false });
    await pending;

    expect(result.blobAudioUrl).not.toBe('blob:late');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late');
  });

  test('disposal releases whatever was expanded', async () => {
    // Without this the WAV blob URL outlives the component and stays allocated
    // for the rest of the tab's life.
    const result = makeResult();
    sdk.getSegmentContext.mockResolvedValue(contextOf([segment(1), segment(2), segment(3)]));
    const { loadNextSegment, dispose } = withComposable();
    await loadNextSegment(result as never, 'both', false);

    dispose();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:expanded');
    expect(result.blobAudioUrl).toBeNull();
  });
});
