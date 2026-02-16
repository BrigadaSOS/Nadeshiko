import type { SearchResult, SearchResultSegment } from '~/stores/search';

interface IOriginalContent {
  textJa: { content: string; highlight?: string };
  textEn: { content?: string; highlight?: string; isMachineTranslated: boolean };
  textEs: { content?: string; highlight?: string; isMachineTranslated: boolean };
}

interface IConcatenation {
  result: SearchResult | null;
  originalContent: IOriginalContent | null;
}

type TextLang = 'textJa' | 'textEn' | 'textEs';
const TEXT_LANGS: TextLang[] = ['textJa', 'textEn', 'textEs'];

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
function concatLangField(
  currentField: SearchResultSegment[TextLang],
  adjacentField: SearchResultSegment[TextLang] | undefined,
  direction: 'forward' | 'backward',
): SearchResultSegment[TextLang];
function concatLangField(
  currentField: SearchResultSegment[TextLang],
  adjacentField: SearchResultSegment[TextLang] | undefined,
  direction: 'both',
  beforeField: SearchResultSegment[TextLang] | undefined,
): SearchResultSegment[TextLang];
function concatLangField(
  currentField: SearchResultSegment[TextLang],
  adjacentField: SearchResultSegment[TextLang] | undefined,
  direction: 'forward' | 'backward' | 'both',
  beforeField?: SearchResultSegment[TextLang] | undefined,
): SearchResultSegment[TextLang] {
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
    };
  }

  return {
    ...currentField,
    content: concatTextField(curContent, adjContent, direction),
    highlight: concatTextField(curHighlight, adjHighlight, direction),
  };
}

export function useSegmentConcatenation() {
  const { contentRating } = useContentRating();
  let activeConcatenation: IConcatenation = {
    result: null,
    originalContent: null,
  };

  const revertActiveConcatenation = () => {
    if (activeConcatenation.result && activeConcatenation.originalContent) {
      if (activeConcatenation.result.urls.blobAudioUrl) {
        window.URL.revokeObjectURL(activeConcatenation.result.urls.blobAudioUrl);
      }

      activeConcatenation.result.urls.blobAudioUrl = null;
      activeConcatenation.result.urls.blobAudio = null;

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
    apiSearch: ReturnType<typeof useApiSearch>,
    isLoading: boolean,
  ) => {
    if (isLoading) return;

    revertActiveConcatenation();

    document.querySelectorAll('#concatenate-button').forEach((e) => {
      (e as HTMLButtonElement).disabled = true;
    });

    const audioUrls: string[] = [result.urls.audioUrl];

    try {
      const response = await apiSearch.getSegmentContext({
        uuid: result.segment.uuid,
        limit: 1,
        contentRating: contentRating.value,
      });

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
          audioUrls.push(nextSegment.urls.audioUrl);
          concatenatedAudio = await concatenateAudios(audioUrls);

          const updatedSegment = { ...result.segment };
          for (const lang of TEXT_LANGS) {
            updatedSegment[lang] = concatLangField(result.segment[lang], nextSegment.segment[lang], 'forward');
          }
          result.segment = updatedSegment;
        } else if (direction === 'backward') {
          if (!previousSegment) return;
          audioUrls.unshift(previousSegment.urls.audioUrl);
          concatenatedAudio = await concatenateAudios(audioUrls);

          const updatedSegment = { ...result.segment };
          for (const lang of TEXT_LANGS) {
            updatedSegment[lang] = concatLangField(result.segment[lang], previousSegment.segment[lang], 'backward');
          }
          result.segment = updatedSegment;
        } else if (direction === 'both') {
          if (!previousSegment || !nextSegment) return;
          audioUrls.unshift(previousSegment.urls.audioUrl);
          audioUrls.push(nextSegment.urls.audioUrl);
          concatenatedAudio = await concatenateAudios(audioUrls);

          const updatedSegment = { ...result.segment };
          for (const lang of TEXT_LANGS) {
            updatedSegment[lang] = concatLangField(
              result.segment[lang],
              nextSegment.segment[lang],
              'both',
              previousSegment.segment[lang],
            );
          }
          result.segment = updatedSegment;
        }

        if (concatenatedAudio) {
          result.urls.blobAudioUrl = concatenatedAudio.blob_url;
          result.urls.blobAudio = concatenatedAudio.blob;
        }
      }
    } catch (error) {
      activeConcatenation = { result: null, originalContent: null };
      console.error('Error fetching context segments:', error);
    } finally {
      document.querySelectorAll('#concatenate-button').forEach((e) => {
        (e as HTMLButtonElement).disabled = false;
      });
    }
  };

  return { revertActiveConcatenation, isConcatenated, loadNextSegment };
}
