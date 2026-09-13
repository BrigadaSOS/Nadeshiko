// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import PitchContour from './PitchContour.vue';

const contour = {
  durationSeconds: 1,
  frameCount: 3,
  voicedFrameCount: 3,
  points: [
    { timeSeconds: 0.1, frequencyHz: 180 },
    { timeSeconds: 0.5, frequencyHz: 240 },
    { timeSeconds: 0.9, frequencyHz: 200 },
  ],
};

describe('PitchContour', () => {
  test('renders an accessible graph with the measured range', () => {
    const wrapper = mount(PitchContour, {
      props: { contour },
      global: { mocks: { $t: (key: string) => key } },
    });

    expect(wrapper.get('[data-testid="sentence-pitch-contour"]').attributes('role')).toBe('img');
    expect(wrapper.get('svg path').attributes('d')).toContain('M');
    expect(wrapper.text()).toContain('180');
    expect(wrapper.text()).toContain('240');
  });
});
