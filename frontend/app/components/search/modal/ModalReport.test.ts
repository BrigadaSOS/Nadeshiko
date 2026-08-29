// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * "Report a problem", which is the only route a reader has to tell us a clip is
 * wrong.
 *
 * It reports two different things through one form -- the SENTENCE, or the
 * TITLE it came from -- and the reason lists are deliberately different, because
 * "wrong timing" is not a thing that can be wrong about a series and "duplicate
 * media" is not a thing that can be wrong about one line. Carrying a reason
 * across that switch would file a report the moderation queue cannot act on.
 *
 * The modal is also REUSED: it stays mounted while the reader moves between
 * cards, so everything it holds has to be reset when the target changes. A
 * description left over from the last report is attached to this one.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const createUserReport = vi.fn();
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useNadeshikoSdk', () => ({ createUserReport }));
vi.stubGlobal('useToastSuccess', toastSuccess);

import { formatMs } from '~/utils/misc';

import ModalReport from './ModalReport.vue';

const segmentTarget = { type: 'SEGMENT', segmentPublicId: 's1', mediaPublicId: 'm1' };
const mediaTarget = { type: 'MEDIA', mediaPublicId: 'm1' };

/** The card the report is filed against; the modal previews it, so every field
 *  the preview reads has to be present. */
const segment = () => ({
  segment: {
    publicId: 's1',
    textJa: { content: '猫' },
    textEn: { content: 'cat', isMachineTranslated: false },
    textEs: { content: 'gato', isMachineTranslated: false },
    episode: 1,
    position: 3,
    startTimeMs: 0,
    endTimeMs: 2000,
    contentRating: 'SAFE',
  },
  media: { publicId: 'm1', nameEn: 'Bocchi', nameRomaji: 'Bocchi', coverUrl: 'c.png' },
});

const mounted: { unmount: () => void }[] = [];

async function render(target: Record<string, unknown> | null = segmentTarget) {
  const wrapper = mount(ModalReport, {
    props: { target: null, segment: segment(), mediaName: 'Bocchi' } as never,
    global: {
      // Template auto-imports go in mocks, not stubGlobal: the compiled render
      // resolves them through the component instance.
      mocks: { $t: (k: string) => k, formatMs },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  // Opened by the target ARRIVING, which is also what resets the form.
  await wrapper.setProps({ target: target as never });
  await nextTick();
  return wrapper;
}

/**
 * The reasons currently offered. They are PILL BUTTONS labelled by translation
 * key, not radios, so the key suffix is the reason itself.
 */
const reasons = (w: ReturnType<typeof mount>) =>
  w
    .findAll('button')
    .map((n) => n.text().trim())
    .filter((t) => t.startsWith('reports.reasons.'))
    .map((t) => t.replace('reports.reasons.', ''));

async function pickReason(w: ReturnType<typeof mount>, reason: string) {
  const pill = w.findAll('button').find((b) => b.text().trim() === `reports.reasons.${reason}`);
  if (!pill) throw new Error(`no reason pill for ${reason}`);
  await pill.trigger('click');
  await nextTick();
}

async function submit(w: ReturnType<typeof mount>) {
  const button = w.findAll('button').find((b) => b.text().trim() === 'reports.submit');
  if (!button) throw new Error('no submit control');
  await button.trigger('click');
  await flushPromises();
}

async function switchTo(w: ReturnType<typeof mount>, label: 'SEGMENT' | 'MEDIA') {
  const key = label === 'MEDIA' ? 'reports.tabMedia' : 'reports.tabSegment';
  const tab = w.findAll('button').find((b) => b.text().trim() === key);
  if (!tab) throw new Error(`no ${label} tab`);
  await tab.trigger('click');
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  createUserReport.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which thing is being reported', () => {
  test('a sentence report opens on the sentence reasons', async () => {
    const wrapper = await render(segmentTarget);

    expect(reasons(wrapper)).toContain('WRONG_TIMING');
    expect(reasons(wrapper)).not.toContain('DUPLICATE_MEDIA');
  });

  test('a title report opens on the title reasons', async () => {
    // "Wrong timing" cannot be true of a series, and offering it files a report
    // the queue cannot act on.
    const wrapper = await render(mediaTarget);

    expect(reasons(wrapper)).toContain('DUPLICATE_MEDIA');
    expect(reasons(wrapper)).not.toContain('WRONG_TIMING');
  });

  test('both lists offer OTHER, which is the escape hatch', async () => {
    expect(reasons(await render(segmentTarget))).toContain('OTHER');
    expect(reasons(await render(mediaTarget))).toContain('OTHER');
  });
});

describe('reopening on another card', () => {
  test('forgets the reason chosen last time', async () => {
    const wrapper = await render(segmentTarget);
    await pickReason(wrapper, 'WRONG_TIMING');

    await wrapper.setProps({ target: { ...segmentTarget, segmentPublicId: 's2' } as never });
    await nextTick();
    await submit(wrapper).catch(() => {});

    expect(createUserReport).not.toHaveBeenCalled();
  });

  test('and forgets what was typed, so it is not attached to the next report', async () => {
    const wrapper = await render(segmentTarget);
    const box = wrapper.find('textarea');
    if (box.exists()) await box.setValue('the audio cuts out');

    await wrapper.setProps({ target: { ...segmentTarget, segmentPublicId: 's2' } as never });
    await nextTick();

    if (box.exists()) expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  test('switching from a sentence to a title report re-picks the tab', async () => {
    const wrapper = await render(segmentTarget);
    expect(reasons(wrapper)).toContain('WRONG_TIMING');

    await wrapper.setProps({ target: mediaTarget as never });
    await nextTick();

    expect(reasons(wrapper)).toContain('DUPLICATE_MEDIA');
  });
});

describe('sending it', () => {
  test('cannot be sent without a reason', async () => {
    // Guarded on the BUTTON as well as in the handler, and the button is what a
    // reader meets: the queue cannot triage a report that says nothing.
    const wrapper = await render(segmentTarget);

    const button = wrapper.findAll('button').find((b) => b.text().trim() === 'reports.submit')!;
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    await flushPromises();

    expect(createUserReport).not.toHaveBeenCalled();
  });

  test('sends the sentence and the reason chosen', async () => {
    const wrapper = await render(segmentTarget);
    await pickReason(wrapper, 'WRONG_TIMING');

    await submit(wrapper);

    expect(createUserReport).toHaveBeenCalledWith(
      expect.objectContaining({ target: segmentTarget, reason: 'WRONG_TIMING' }),
    );
  });

  test('a title report is sent against the TITLE, not the sentence', async () => {
    const wrapper = await render(mediaTarget);
    await pickReason(wrapper, 'DUPLICATE_MEDIA');

    await submit(wrapper);

    expect(createUserReport).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: 'MEDIA', mediaPublicId: 'm1' } }),
    );
  });

  test('switching to the title tab files it against the TITLE, not the sentence', async () => {
    // The case the branch exists for: opened from a sentence card, then the
    // reader decides the problem is with the series. Sending the segment target
    // under a media reason files a report the queue cannot act on.
    const wrapper = await render(segmentTarget);
    await switchTo(wrapper, 'MEDIA');
    await pickReason(wrapper, 'DUPLICATE_MEDIA');

    await submit(wrapper);

    expect(createUserReport).toHaveBeenCalledWith(
      expect.objectContaining({ target: { type: 'MEDIA', mediaPublicId: 'm1' } }),
    );
  });

  test('an empty description is left out rather than sent blank', async () => {
    const wrapper = await render(segmentTarget);
    await pickReason(wrapper, 'OTHER');

    await submit(wrapper);

    expect(createUserReport.mock.calls[0]![0].description).toBeUndefined();
  });

  test('closes and thanks the reader when it lands', async () => {
    const wrapper = await render(segmentTarget);
    await pickReason(wrapper, 'WRONG_TIMING');

    await submit(wrapper);

    expect(toastSuccess).toHaveBeenCalledWith('reports.submitSuccess');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  test('a FAILURE stays open and says so beside the form they filled in', async () => {
    // Not a toast over a modal that has closed: the reader still has their
    // description, and closing would make them write it again.
    createUserReport.mockRejectedValue(new Error('down'));
    const wrapper = await render(segmentTarget);
    await pickReason(wrapper, 'WRONG_TIMING');

    await submit(wrapper);

    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.text()).toContain('reports.submitError');
    expect(handleApiError).toHaveBeenCalledWith('reports:submit-failed', expect.anything(), { toastKey: false });
  });

  test('ignores a second press while the first is in flight', async () => {
    let release!: () => void;
    createUserReport.mockReturnValue(new Promise<void>((r) => (release = () => r())));
    const wrapper = await render(segmentTarget);
    await pickReason(wrapper, 'WRONG_TIMING');
    const button = wrapper.findAll('button').find((b) => b.text().trim() === 'reports.submit')!;

    await button.trigger('click');
    await button.trigger('click');
    release();
    await flushPromises();

    expect(createUserReport).toHaveBeenCalledTimes(1);
  });
});
