/** A voiced pitch sample measured from a sentence's audio. */
export type PitchContourPoint = {
  timeSeconds: number;
  frequencyHz: number;
};

export type PitchContour = {
  durationSeconds: number;
  points: PitchContourPoint[];
  /** Number of analysis windows which contained a usable voiced estimate. */
  voicedFrameCount: number;
  frameCount: number;
};

export type PitchContourOptions = {
  /** Speech frequencies outside this range are ignored. */
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  frameSize?: number;
  hopSize?: number;
  minRms?: number;
  minCorrelation?: number;
};

const DEFAULTS: Required<PitchContourOptions> = {
  minFrequencyHz: 70,
  maxFrequencyHz: 450,
  frameSize: 2048,
  hopSize: 512,
  minRms: 0.012,
  minCorrelation: 0.45,
};

/**
 * Estimate the fundamental frequency of each short, overlapping audio frame.
 *
 * This intentionally uses normalized autocorrelation instead of a model or a
 * third-party service: it works offline once the clip is fetched, has no
 * credentials or user-audio upload, and is deterministic in tests. It is a
 * best-effort visual aid, not a phonetic/accent annotation; unvoiced frames
 * are skipped and noisy/multi-speaker clips may contain no usable points.
 */
export function extractPitchContour(audio: AudioBuffer, options: PitchContourOptions = {}): PitchContour {
  const config = { ...DEFAULTS, ...options };
  // Speech pitch does not need a 44.1/48 kHz analysis rate. Reducing it to
  // 8 kHz bounds the autocorrelation search and prevents a long sentence from
  // monopolising the main thread (at 44.1 kHz the same search is ~5.5x wider).
  const sourceSampleRate = audio.sampleRate;
  if (sourceSampleRate <= 0 || audio.numberOfChannels <= 0 || audio.length <= 0) {
    return { durationSeconds: 0, points: [], voicedFrameCount: 0, frameCount: 0 };
  }
  const sampleRate = Math.min(sourceSampleRate, 8_000);
  const sourceChannels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const length = Math.ceil((audio.length * sampleRate) / sourceSampleRate);
  const monoSamples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const start = Math.floor((index * sourceSampleRate) / sampleRate);
    const end = Math.min(audio.length, Math.max(start + 1, Math.floor(((index + 1) * sourceSampleRate) / sampleRate)));
    let sum = 0;
    let count = 0;
    for (const channel of sourceChannels) {
      for (let sourceIndex = start; sourceIndex < end; sourceIndex++) {
        sum += channel[sourceIndex] ?? 0;
        count++;
      }
    }
    monoSamples[index] = count > 0 ? sum / count : 0;
  }
  const durationSeconds = audio.length / sourceSampleRate;
  const frameCount = length < config.frameSize ? 0 : Math.floor((length - config.frameSize) / config.hopSize) + 1;
  if (frameCount === 0 || sampleRate <= 0) {
    return { durationSeconds, points: [], voicedFrameCount: 0, frameCount };
  }

  const minLag = Math.max(1, Math.floor(sampleRate / config.maxFrequencyHz));
  const maxLag = Math.min(config.frameSize - 2, Math.ceil(sampleRate / config.minFrequencyHz));
  const points: PitchContourPoint[] = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * config.hopSize;
    const mono = new Float32Array(config.frameSize);
    let energy = 0;
    for (let index = 0; index < config.frameSize; index++) {
      const sample = monoSamples[offset + index] ?? 0;
      // A Hann window reduces clicks at the frame boundary and improves the
      // correlation peak on clips with music/noise around the speech.
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (config.frameSize - 1));
      const windowedSample = sample * window;
      mono[index] = windowedSample;
      energy += windowedSample * windowedSample;
    }
    const rms = Math.sqrt(energy / config.frameSize);
    if (rms < config.minRms) continue;

    let bestLag = -1;
    let bestCorrelation = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let numerator = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let index = 0; index < config.frameSize - lag; index++) {
        const left = mono[index] ?? 0;
        const right = mono[index + lag] ?? 0;
        numerator += left * right;
        leftEnergy += left * left;
        rightEnergy += right * right;
      }
      const denominator = Math.sqrt(leftEnergy * rightEnergy);
      const correlation = denominator > 0 ? numerator / denominator : 0;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestLag < 0 || bestCorrelation < config.minCorrelation) continue;
    points.push({
      timeSeconds: (offset + config.frameSize / 2) / sampleRate,
      frequencyHz: sampleRate / bestLag,
    });
  }

  return { durationSeconds, points, voicedFrameCount: points.length, frameCount };
}
