import { describe, expect, test } from 'vitest';
import { extractPitchContour } from './pitchContour';

function audioBuffer(samples: Float32Array, sampleRate = 8_000): AudioBuffer {
  return {
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => samples,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

function sine(frequency: number, sampleRate: number, seconds: number, amplitude = 0.5) {
  const samples = new Float32Array(Math.floor(sampleRate * seconds));
  for (let index = 0; index < samples.length; index++) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
}

describe('extractPitchContour', () => {
  test('finds a stable voiced frequency in a synthetic tone', () => {
    const contour = extractPitchContour(audioBuffer(sine(200, 8_000, 1)));

    expect(contour.frameCount).toBeGreaterThan(0);
    expect(contour.voicedFrameCount).toBeGreaterThan(0);
    expect(contour.points.every((point) => Math.abs(point.frequencyHz - 200) < 12)).toBe(true);
    expect(contour.points.at(-1)?.timeSeconds).toBeLessThanOrEqual(1);
  });

  test('ignores silence instead of drawing a false pitch', () => {
    const contour = extractPitchContour(audioBuffer(new Float32Array(8_000)));

    expect(contour.frameCount).toBeGreaterThan(0);
    expect(contour.points).toEqual([]);
  });

  test('downmixes stereo audio before estimating pitch', () => {
    const left = sine(150, 8_000, 0.8);
    const right = sine(150, 8_000, 0.8);
    const contour = extractPitchContour({
      ...audioBuffer(left),
      numberOfChannels: 2,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as unknown as AudioBuffer);

    expect(contour.points.length).toBeGreaterThan(0);
    expect(contour.points.every((point) => Math.abs(point.frequencyHz - 150) < 12)).toBe(true);
  });
});
