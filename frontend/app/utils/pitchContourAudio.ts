import { fetchAudioSegment } from '~/utils/media';
import { extractPitchContour, type PitchContour } from '~/utils/pitchContour';

/** Fetch and decode a sentence clip locally; decoded audio is discarded after analysis. */
export async function loadPitchContour(audioUrl: string): Promise<PitchContour> {
  if (typeof window === 'undefined') throw new Error('Pitch analysis is browser-only');
  const AudioContextClass =
    window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser does not support audio analysis');
  const { response } = await fetchAudioSegment(audioUrl);
  const context = new AudioContextClass();
  try {
    const contour = extractPitchContour(await context.decodeAudioData(await response.arrayBuffer()));
    if (contour.points.length < 2) throw new Error('No reliable voiced pitch found');
    return contour;
  } finally {
    await context.close().catch(() => undefined);
  }
}
