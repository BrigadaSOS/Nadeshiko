import { usePlayerStore } from '~/stores/player';
import type { SearchResult, Segment } from '~/types/search';
import { describeAudioFetchFailure } from '~/utils/media';
import { reportError } from '~/utils/reportError';
import { resolveContextResponse } from '~/utils/resolvers';
import {
  buildExpandedTexts,
  orderAudioUrls,
  pickNeighbours,
  type ExpandDirection,
  type ExpandedTexts,
} from '~/utils/segmentConcatenation';
import { useToastError, useToastInfo } from '~/utils/toast';

interface IConcatenation {
  result: SearchResult | null;
  originalContent: ExpandedTexts | null;
}

/** How an expansion attempt ended, as reported to product analytics. */
type ExpandOutcome =
  | 'expanded'
  /** The episode has no segment on the side(s) asked for. */
  | 'boundary'
  /** The context response did not contain the segment being expanded. */
  | 'unplaceable'
  /** The context request itself failed. */
  | 'context-failed';

/** Whether the expansion's audio could be built alongside its text. */
type ExpandAudioOutcome =
  | 'built'
  | 'failed'
  /** Built, but the expansion it belonged to was dropped before it landed. */
  | 'abandoned';

/**
 * Report a failed expansion audio build with everything known about the fetch.
 *
 * The diagnosis is async, so it lives here rather than inline. Without the extra
 * attributes these reports are a bare `Failed to fetch` -- see
 * `describeAudioFetchFailure`.
 */
async function reportConcatenationFailure(
  audioErr: unknown,
  direction: ExpandDirection,
  result: SearchResult,
): Promise<void> {
  // Never rejects. This is called un-awaited, so a rejection would arrive as an
  // unhandled rejection and be captured as its own bogus exception on top of the
  // one being reported.
  const diagnosis = await describeAudioFetchFailure(audioErr).catch(() => ({}));

  reportError('segment:audio-concatenation-failed', audioErr, {
    direction,
    'segment.publicId': result.segment.publicId,
    ...diagnosis,
  });
}

export function useSegmentConcatenation() {
  const { contentRating } = useContentRating();
  const player = usePlayerStore();
  const { t } = useI18n();
  // Resolved at setup: in production `usePostHog()` goes through `useNuxtApp()`,
  // which throws once the call stack has passed through an `await`.
  const posthog = usePostHog();

  const activeConcatenation = shallowRef<IConcatenation>({
    result: null,
    originalContent: null,
  });

  /**
   * True while an expansion is in flight. Callers bind their expand controls to
   * it; a second expansion started mid-flight would revert the first one while
   * its audio was still being built, stranding the WAV blob URL.
   *
   * Binding it is not optional. While this went unbound, the guard below dropped
   * every click landing during the (multi-second) audio build with no feedback at
   * all -- the reader clicked "expand both" right after "expand right" and
   * nothing whatsoever happened.
   */
  const isConcatenating = ref(false);

  /**
   * Set once the owning component is gone. An expansion started just before that
   * still has a fetch and a decode to finish, and it must not attach a blob to a
   * card nothing renders any more -- there would be no revert left to release it.
   */
  let disposed = false;

  const track = (
    result: SearchResult,
    direction: ExpandDirection,
    outcome: ExpandOutcome,
    extra: Record<string, unknown> = {},
  ) => {
    posthog?.capture('segment_expand_completed', {
      direction,
      outcome,
      media_id: result.media.publicId,
      segment_id: result.segment.publicId,
      ...extra,
    });
  };

  const revertActiveConcatenation = () => {
    const { result, originalContent } = activeConcatenation.value;
    if (!result || !originalContent) return;

    if (result.blobAudioUrl) {
      // Order matters: the player has to let go of the url before it stops
      // resolving, or its element is left pointing at a dead address.
      player.releaseIfSource(result.blobAudioUrl);
      window.URL.revokeObjectURL(result.blobAudioUrl);
    }

    result.blobAudioUrl = null;
    result.blobAudio = null;

    result.segment = {
      ...result.segment,
      textJa: { ...originalContent.textJa },
      textEn: { ...originalContent.textEn },
      textEs: { ...originalContent.textEs },
    };

    // The text is the segment's own again, so the clip has to shrink back with
    // it -- and the iframe has to be told, since unlike a media element it does
    // not re-read the window on its next play.
    result.expandedWindow = null;
    player.retimeCurrentClip(result);

    activeConcatenation.value = { result: null, originalContent: null };
  };

  /** The result currently expanded, so callers can drop it when it leaves their list. */
  const concatenatedResult = computed(() => activeConcatenation.value.result);

  const isConcatenated = (result: SearchResult) => {
    return activeConcatenation.value.result === result;
  };

  const snapshot = (segment: Segment): ExpandedTexts => ({
    textJa: { ...segment.textJa },
    textEn: { ...segment.textEn },
    textEs: { ...segment.textEs },
  });

  /**
   * Build and attach the expansion's audio.
   *
   * Deliberately separate from the text swap and awaited after it: the text is
   * the part that can be produced synchronously, and holding it back until three
   * audio objects have been fetched and decoded would make every expansion feel
   * broken for the second or two that takes.
   */
  const attachExpandedAudio = async (
    result: SearchResult,
    direction: ExpandDirection,
    audioUrls: string[],
  ): Promise<{ outcome: ExpandAudioOutcome; cacheBypassed: boolean }> => {
    try {
      const concatenatedAudio = await concatenateAudios(audioUrls);

      // The expansion this audio belongs to may have been dropped while it was
      // being built -- the reader navigated away (`onScopeDispose`) or the card
      // left the result list. Attaching now would put expanded audio on a card
      // showing unexpanded text, and nothing would ever revoke the blob.
      if (disposed || activeConcatenation.value.result !== result) {
        window.URL.revokeObjectURL(concatenatedAudio.blob_url);
        return { outcome: 'abandoned', cacheBypassed: concatenatedAudio.cacheBypassed };
      }

      result.blobAudioUrl = concatenatedAudio.blob_url;
      result.blobAudio = concatenatedAudio.blob;
      return { outcome: 'built', cacheBypassed: concatenatedAudio.cacheBypassed };
    } catch (audioErr) {
      // Deliberately un-awaited: the diagnosis re-requests the failed url and can
      // wait seconds, while `isConcatenating` is cleared by the caller --
      // awaiting would leave the reader's expand controls disabled long after the
      // failure they can already see.
      void reportConcatenationFailure(audioErr, direction, result);
      // Said out loud rather than left to be discovered: the text on screen has
      // grown, but the Anki export is about to fall back to the original clip,
      // and silently shipping a card with the wrong audio on it is worse than
      // the expansion having failed outright.
      //
      // A YouTube segment gets the shorter of the two messages: its playback is
      // streamed from a clip window rather than assembled from these objects,
      // so it expanded regardless and only the export is affected. Saying
      // otherwise would send the reader looking for a playback fault that is
      // not there.
      const streamed = result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
      useToastError(t(streamed ? 'segment.expandAudioFailedStreamed' : 'segment.expandAudioFailed'));
      return { outcome: 'failed', cacheBypassed: false };
    }
  };

  const loadNextSegment = async (result: SearchResult, direction: ExpandDirection, isLoading: boolean) => {
    if (isLoading || isConcatenating.value) return;

    isConcatenating.value = true;
    // Whether this call got as far as replacing the card's text, and so owns the
    // revert on the way out. Nothing before that point may revert: the expansion
    // the reader is already looking at is not this call's to throw away.
    let swapped = false;

    try {
      const sdk = useNadeshikoSdk();
      const raw = await sdk.getSegmentContext({
        segmentPublicId: result.segment.publicId,
        take: 1,
        contentRating: contentRating.value,
      });
      // The reader left while the context was in flight; expanding a card that is
      // no longer rendered would only strand its blob.
      if (disposed) return;

      const response = raw ? resolveContextResponse(raw) : null;
      const segments = response?.segments ?? [];

      const neighbours = segments.length > 0 ? pickNeighbours(segments, result.segment.publicId, direction) : null;

      if (!neighbours) {
        track(result, direction, 'unplaceable');
        useToastError(t('segment.expandFailed'));
        return;
      }

      const { before, after, missing } = neighbours;

      // Nothing on either side asked for: the segment opens or closes the
      // episode. Previously a bare `return`, which is exactly what made the menu
      // item look dead.
      if (!before && !after) {
        track(result, direction, 'boundary', { sides_missing: missing });
        useToastInfo(t(missing.includes('before') ? 'segment.expandNoPrevious' : 'segment.expandNoNext'));
        return;
      }

      // One side of an "expand both" missing is not a failure: the other side
      // still expands, and the reader is told which half they got.
      if (missing.length > 0) {
        useToastInfo(t(missing.includes('before') ? 'segment.expandNoPrevious' : 'segment.expandNoNext'));
      }

      // Everything that could have made this a no-op is behind us, so the
      // previous expansion can finally be undone. Doing it up front instead --
      // as this used to -- meant an "expand left" that turned out to be at the
      // start of an episode silently threw away the expansion already on screen.
      revertActiveConcatenation();

      // Snapshotted after the revert, so it is the original text and not
      // whatever the last expansion left behind.
      const originalContent = snapshot(result.segment);
      activeConcatenation.value = { result, originalContent };
      result.segment = { ...result.segment, ...buildExpandedTexts(result.segment, before, after) };
      // Set with the text and not with the audio below, because it costs
      // nothing to work out: a YouTube clip is streamed from a window rather
      // than built from objects, so it grows the moment the text does instead
      // of waiting on a fetch and a decode it never uses.
      result.expandedWindow = {
        startMs: before?.segment.startTimeMs ?? result.segment.startTimeMs,
        endMs: after?.segment.endTimeMs ?? result.segment.endTimeMs,
      };
      player.retimeCurrentClip(result);
      swapped = true;

      // `urls` is untouched by the text swap above, so the segment's own object
      // is still the right one to order the neighbours around.
      const audio = await attachExpandedAudio(result, direction, orderAudioUrls(result.segment, before, after));

      track(result, direction, 'expanded', {
        audio: audio.outcome,
        audio_cache_bypassed: audio.cacheBypassed,
        sides_missing: missing,
        segments_merged: 1 + (before ? 1 : 0) + (after ? 1 : 0),
      });
    } catch (error) {
      reportError('segment:expansion-failed', error, {
        'segment.publicId': result.segment.publicId,
        direction,
      });
      track(result, direction, 'context-failed');
      useToastError(t('segment.expandFailed'));
      // Only what this call put on screen. Reverting rather than blanking: a
      // failure landing after the swap would otherwise leave the card expanded
      // with no way back and its blob URL unreachable.
      if (swapped) revertActiveConcatenation();
    } finally {
      isConcatenating.value = false;
    }
  };

  // Without this the WAV blob URL of whatever was expanded outlives the
  // component and stays allocated for the rest of the tab's life.
  onScopeDispose(() => {
    disposed = true;
    revertActiveConcatenation();
  });

  return { revertActiveConcatenation, isConcatenated, concatenatedResult, isConcatenating, loadNextSegment };
}
