import type { SearchResult, Segment } from '~/types/search';
import { describeAudioFetchFailure } from '~/utils/media';
import { reportError } from '~/utils/reportError';
import { resolveContextResponse } from '~/utils/resolvers';

interface IOriginalContent {
  textJa: Segment['textJa'];
  textEn: Segment['textEn'];
  textEs: Segment['textEs'];
}

interface IConcatenation {
  result: SearchResult | null;
  originalContent: IOriginalContent | null;
}

type TextFieldBase = { content: string; highlight?: string; tokens?: unknown };

/**
 * Concatenate a single text field (content or highlight) between current and adjacent segments.
 * Wraps the adjacent segment's text in a cyan span.
 */
function concatTextField(
  current: string,
  adjacent: string,
  direction: 'forward' | 'backward' | 'both',
  adjacentBefore?: string,
): string {
  const wrap = (text: string) => `<span class="text-cyan-200">${text}</span>`;

  if (direction === 'forward') {
    return `${current} ${wrap(adjacent)}`;
  }
  if (direction === 'backward') {
    return `${wrap(adjacent)} ${current}`;
  }
  // both
  return `${wrap(adjacentBefore ?? '')} ${current} ${wrap(adjacent)}`;
}

/**
 * Build a concatenated text field object for a given language.
 */
function concatLangField<T extends TextFieldBase>(
  currentField: T,
  adjacentField: T | undefined,
  direction: 'forward' | 'backward',
): T;
function concatLangField<T extends TextFieldBase>(
  currentField: T,
  adjacentField: T | undefined,
  direction: 'both',
  beforeField: T | undefined,
): T;
function concatLangField<T extends TextFieldBase>(
  currentField: T,
  adjacentField: T | undefined,
  direction: 'forward' | 'backward' | 'both',
  beforeField?: T | undefined,
): T {
  const curContent = currentField.content || '';
  const curHighlight = currentField.highlight || curContent;
  const adjContent = adjacentField?.content || '';
  const adjHighlight = adjacentField?.highlight || adjContent;

  if (direction === 'both') {
    const befContent = beforeField?.content || '';
    const befHighlight = beforeField?.highlight || befContent;
    return {
      ...currentField,
      content: concatTextField(curContent, adjContent, 'both', befContent),
      highlight: concatTextField(curHighlight, adjHighlight, 'both', befHighlight),
      tokens: null,
    } as T;
  }

  return {
    ...currentField,
    content: concatTextField(curContent, adjContent, direction),
    highlight: concatTextField(curHighlight, adjHighlight, direction),
    tokens: null,
  } as T;
}

/**
 * Report a failed expansion audio build with everything known about the fetch.
 *
 * All three expansion branches report identically and the diagnosis is async, so
 * it lives here rather than three times over. Without the extra attributes these
 * reports are a bare `Failed to fetch` -- see `describeAudioFetchFailure`.
 */
async function reportConcatenationFailure(
  audioErr: unknown,
  direction: 'forward' | 'backward' | 'both',
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
  const activeConcatenation = shallowRef<IConcatenation>({
    result: null,
    originalContent: null,
  });

  /**
   * True while an expansion is in flight. Callers bind their expand controls to
   * it; a second expansion started mid-flight would revert the first one while
   * its audio was still being built, stranding the WAV blob URL.
   */
  const isConcatenating = ref(false);

  const revertActiveConcatenation = () => {
    const { result, originalContent } = activeConcatenation.value;
    if (!result || !originalContent) return;

    if (result.blobAudioUrl) {
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

    activeConcatenation.value = { result: null, originalContent: null };
  };

  /** The result currently expanded, so callers can drop it when it leaves their list. */
  const concatenatedResult = computed(() => activeConcatenation.value.result);

  const isConcatenated = (result: SearchResult) => {
    return activeConcatenation.value.result === result;
  };

  const loadNextSegment = async (
    result: SearchResult,
    direction: 'forward' | 'backward' | 'both',
    isLoading: boolean,
  ) => {
    if (isLoading || isConcatenating.value) return;

    revertActiveConcatenation();

    isConcatenating.value = true;

    const audioUrls: string[] = [result.segment.urls.audioUrl];
    // Snapshot before any branch mutates `result.segment`; which branch (if any)
    // ends up owning it is decided after the neighbour guards below.
    const originalContent: IOriginalContent = {
      textJa: { ...result.segment.textJa },
      textEn: { ...result.segment.textEn },
      textEs: { ...result.segment.textEs },
    };

    try {
      const sdk = useNadeshikoSdk();
      const raw = await sdk.getSegmentContext({
        segmentPublicId: result.segment.publicId,
        take: 1,
        contentRating: contentRating.value,
      });
      const response = raw ? resolveContextResponse(raw) : null;

      if (response && response.segments.length > 0) {
        const currentIdx = response.segments.findIndex((s) => s.segment.publicId === result.segment.publicId);
        if (currentIdx === -1) return;
        const previousSegment = response.segments[currentIdx - 1];
        const nextSegment = response.segments[currentIdx + 1];

        if (direction === 'forward') {
          if (!nextSegment) return;

          activeConcatenation.value = { result, originalContent };
          result.segment = {
            ...result.segment,
            textJa: concatLangField(result.segment.textJa, nextSegment.segment.textJa, 'forward'),
            textEn: concatLangField(result.segment.textEn, nextSegment.segment.textEn, 'forward'),
            textEs: concatLangField(result.segment.textEs, nextSegment.segment.textEs, 'forward'),
          };

          audioUrls.push(nextSegment.segment.urls.audioUrl);
          try {
            const concatenatedAudio = await concatenateAudios(audioUrls);
            result.blobAudioUrl = concatenatedAudio.blob_url;
            result.blobAudio = concatenatedAudio.blob;
          } catch (audioErr) {
            // Deliberately un-awaited: the diagnosis re-requests the failed url
            // and can wait seconds, while `isConcatenating` is cleared in the
            // `finally` below -- awaiting would leave the reader's expand
            // controls disabled long after the failure they can already see.
            void reportConcatenationFailure(audioErr, direction, result);
          }
        } else if (direction === 'backward') {
          if (!previousSegment) return;

          activeConcatenation.value = { result, originalContent };
          result.segment = {
            ...result.segment,
            textJa: concatLangField(result.segment.textJa, previousSegment.segment.textJa, 'backward'),
            textEn: concatLangField(result.segment.textEn, previousSegment.segment.textEn, 'backward'),
            textEs: concatLangField(result.segment.textEs, previousSegment.segment.textEs, 'backward'),
          };

          audioUrls.unshift(previousSegment.segment.urls.audioUrl);
          try {
            const concatenatedAudio = await concatenateAudios(audioUrls);
            result.blobAudioUrl = concatenatedAudio.blob_url;
            result.blobAudio = concatenatedAudio.blob;
          } catch (audioErr) {
            // Deliberately un-awaited: the diagnosis re-requests the failed url
            // and can wait seconds, while `isConcatenating` is cleared in the
            // `finally` below -- awaiting would leave the reader's expand
            // controls disabled long after the failure they can already see.
            void reportConcatenationFailure(audioErr, direction, result);
          }
        } else if (direction === 'both') {
          if (!previousSegment || !nextSegment) return;

          activeConcatenation.value = { result, originalContent };
          result.segment = {
            ...result.segment,
            textJa: concatLangField(
              result.segment.textJa,
              nextSegment.segment.textJa,
              'both',
              previousSegment.segment.textJa,
            ),
            textEn: concatLangField(
              result.segment.textEn,
              nextSegment.segment.textEn,
              'both',
              previousSegment.segment.textEn,
            ),
            textEs: concatLangField(
              result.segment.textEs,
              nextSegment.segment.textEs,
              'both',
              previousSegment.segment.textEs,
            ),
          };

          audioUrls.unshift(previousSegment.segment.urls.audioUrl);
          audioUrls.push(nextSegment.segment.urls.audioUrl);
          try {
            const concatenatedAudio = await concatenateAudios(audioUrls);
            result.blobAudioUrl = concatenatedAudio.blob_url;
            result.blobAudio = concatenatedAudio.blob;
          } catch (audioErr) {
            // Deliberately un-awaited: the diagnosis re-requests the failed url
            // and can wait seconds, while `isConcatenating` is cleared in the
            // `finally` below -- awaiting would leave the reader's expand
            // controls disabled long after the failure they can already see.
            void reportConcatenationFailure(audioErr, direction, result);
          }
        }
      }
    } catch (error) {
      reportError('segment:expansion-failed', error, {
        'segment.publicId': result.segment.publicId,
        direction,
      });
      // Reverting rather than blanking: if the failure landed after a branch had
      // already swapped in the concatenated text, blanking would leave the card
      // expanded with no way back and its blob URL unreachable.
      revertActiveConcatenation();
    } finally {
      isConcatenating.value = false;
    }
  };

  // Without this the WAV blob URL of whatever was expanded outlives the
  // component and stays allocated for the rest of the tab's life.
  onScopeDispose(revertActiveConcatenation);

  return { revertActiveConcatenation, isConcatenated, concatenatedResult, isConcatenating, loadNextSegment };
}
