import type { SearchResult, Segment } from '~/types/search';
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

type TextFieldBase = { content: string; highlight?: string };

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
    } as T;
  }

  return {
    ...currentField,
    content: concatTextField(curContent, adjContent, direction),
    highlight: concatTextField(curHighlight, adjHighlight, direction),
  } as T;
}

export function useSegmentConcatenation() {
  const { contentRating } = useContentRating();
  let activeConcatenation: IConcatenation = {
    result: null,
    originalContent: null,
  };

  const revertActiveConcatenation = () => {
    if (activeConcatenation.result && activeConcatenation.originalContent) {
      if (activeConcatenation.result.blobAudioUrl) {
        window.URL.revokeObjectURL(activeConcatenation.result.blobAudioUrl);
      }

      activeConcatenation.result.blobAudioUrl = null;
      activeConcatenation.result.blobAudio = null;

      activeConcatenation.result.segment = {
        ...activeConcatenation.result.segment,
        textJa: { ...activeConcatenation.originalContent.textJa },
        textEn: { ...activeConcatenation.originalContent.textEn },
        textEs: { ...activeConcatenation.originalContent.textEs },
      };

      activeConcatenation = { result: null, originalContent: null };
    }
  };

  const isConcatenated = (result: SearchResult) => {
    return activeConcatenation.result === result;
  };

  const loadNextSegment = async (
    result: SearchResult,
    direction: 'forward' | 'backward' | 'both',
    isLoading: boolean,
  ) => {
    if (isLoading) return;

    revertActiveConcatenation();

    document.querySelectorAll('#concatenate-button').forEach((e) => {
      (e as HTMLButtonElement).disabled = true;
    });

    const audioUrls: string[] = [result.segment.urls.audioUrl];

    try {
      const sdk = useNadeshikoSdk();
      const raw = await sdk.getSegmentContext({
        path: { uuid: result.segment.uuid },
        query: {
          limit: 1,
          contentRating: contentRating.value,
          include: ['media'],
        },
      });
      const response = raw.data ? resolveContextResponse(raw.data) : null;

      if (response && response.segments.length > 0) {
        const previousSegment = response.segments[0];
        const nextSegment = response.segments[2];

        activeConcatenation = {
          result,
          originalContent: {
            textJa: { ...result.segment.textJa },
            textEn: { ...result.segment.textEn },
            textEs: { ...result.segment.textEs },
          },
        };

        let concatenatedAudio: Awaited<ReturnType<typeof concatenateAudios>> | null = null;

        if (direction === 'forward') {
          if (!nextSegment) return;
          audioUrls.push(nextSegment.segment.urls.audioUrl);
          concatenatedAudio = await concatenateAudios(audioUrls);

          result.segment = {
            ...result.segment,
            textJa: concatLangField(result.segment.textJa, nextSegment.segment.textJa, 'forward'),
            textEn: concatLangField(result.segment.textEn, nextSegment.segment.textEn, 'forward'),
            textEs: concatLangField(result.segment.textEs, nextSegment.segment.textEs, 'forward'),
          };
        } else if (direction === 'backward') {
          if (!previousSegment) return;
          audioUrls.unshift(previousSegment.segment.urls.audioUrl);
          concatenatedAudio = await concatenateAudios(audioUrls);

          result.segment = {
            ...result.segment,
            textJa: concatLangField(result.segment.textJa, previousSegment.segment.textJa, 'backward'),
            textEn: concatLangField(result.segment.textEn, previousSegment.segment.textEn, 'backward'),
            textEs: concatLangField(result.segment.textEs, previousSegment.segment.textEs, 'backward'),
          };
        } else if (direction === 'both') {
          if (!previousSegment || !nextSegment) return;
          audioUrls.unshift(previousSegment.segment.urls.audioUrl);
          audioUrls.push(nextSegment.segment.urls.audioUrl);
          concatenatedAudio = await concatenateAudios(audioUrls);

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
        }

        if (concatenatedAudio) {
          result.blobAudioUrl = concatenatedAudio.blob_url;
          result.blobAudio = concatenatedAudio.blob;
        }
      }
    } catch {
      activeConcatenation = { result: null, originalContent: null };
    } finally {
      document.querySelectorAll('#concatenate-button').forEach((e) => {
        (e as HTMLButtonElement).disabled = false;
      });
    }
  };

  return { revertActiveConcatenation, isConcatenated, loadNextSegment };
}
