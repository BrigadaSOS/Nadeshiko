// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { TEXT_MAX_LENGTH } from './segmentEditState';

/**
 * The editing form inside the segment editor.
 *
 * Long, and almost all of it is fields bound straight to a form object the
 * parent owns. Two things in it are not: the character counter, whose colours
 * are the only warning an editor gets before `maxlength` silently stops
 * accepting their typing, and the status pills, where the selected one is
 * distinguished by colour alone -- so a pill that fails to look selected leaves
 * an editor unable to tell what they are about to save a segment as.
 *
 * The JSON field's `blur` validation is here too: it writes into the parent's
 * error object, and a save gate that reads that object is only as good as the
 * write.
 */
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${Object.values(params).join(',')})` : key),
}));

import SegmentEditForm from './SegmentEditForm.vue';

function formState(overrides: Record<string, unknown> = {}) {
  return reactive({
    ja: '',
    en: '',
    enMt: false,
    es: '',
    esMt: false,
    status: 'ACTIVE',
    contentRating: 'SAFE',
    position: 1,
    startTimeMs: 0,
    endTimeMs: 1000,
    ratingAnalysisJson: '',
    ...overrides,
  });
}

const mounted: { unmount: () => void }[] = [];

function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(SegmentEditForm, {
    props: {
      segment: { basic_info: { id_media: 1 } },
      form: formState(),
      jsonErrors: reactive({ ratingAnalysis: '' }),
      activeSnapshotNumber: null,
      errorMessage: '',
      isLoadingInternal: false,
      internalHashedId: null,
      internalStorage: null,
      internalStorageBasePath: null,
      ...props,
    } as never,
    global: { stubs: { SearchModalSegmentEditMetadata: true, NuxtLink: true } },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** The colour class on the "n/500" counter under the first textarea. */
function counterClass(length: number) {
  const wrapper = render({ form: formState({ ja: 'あ'.repeat(length) }) });
  const counter = wrapper.findAll('div').find((d) => d.text() === `${length}/${TEXT_MAX_LENGTH}`);
  if (!counter) throw new Error(`no counter reading ${length}/${TEXT_MAX_LENGTH}`);
  return counter.classes().join(' ');
}

const pill = (wrapper: ReturnType<typeof render>, label: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === label);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the character counter', () => {
  test('is quiet while there is room left', () => {
    expect(counterClass(10)).toContain('text-neutral-500');
  });

  test('warns as the limit comes into view', () => {
    // `maxlength` stops accepting keystrokes with no message of any kind, so
    // this colour is the only notice an editor gets that it is coming.
    expect(counterClass(TEXT_MAX_LENGTH * 0.8)).toContain('text-amber-400');
  });

  test('is still quiet one character before the warning', () => {
    // An off-by-one here paints the counter amber for a sentence that is
    // nowhere near the limit, which trains editors to ignore it.
    expect(counterClass(TEXT_MAX_LENGTH * 0.8 - 1)).toContain('text-neutral-500');
  });

  test('goes red exactly at the limit, where typing stops working', () => {
    expect(counterClass(TEXT_MAX_LENGTH)).toContain('text-red-400');
  });

  test('is not red one character short of it', () => {
    expect(counterClass(TEXT_MAX_LENGTH - 1)).toContain('text-amber-400');
  });

  test('counts each language separately, colour and all', () => {
    // A counter wired to the wrong field paints the Spanish box red because the
    // Japanese one is full -- and the editor stops typing a sentence that had
    // 490 characters of room left.
    // Three different lengths, so a counter reading the wrong field shows up as
    // a missing reading rather than as a duplicate of one that happens to match.
    const warning = TEXT_MAX_LENGTH * 0.8;
    const wrapper = render({
      form: formState({ ja: 'あ'.repeat(TEXT_MAX_LENGTH), en: 'e'.repeat(warning), es: 'hola' }),
    });
    const counter = (length: number) => wrapper.findAll('div').find((d) => d.text() === `${length}/${TEXT_MAX_LENGTH}`);

    expect(counter(TEXT_MAX_LENGTH)?.classes()).toContain('text-red-400');
    expect(counter(warning)?.classes()).toContain('text-amber-400');
    expect(counter(4)?.classes()).toContain('text-neutral-500');
  });
});

describe('the status pills', () => {
  test('the chosen status is the only one that looks chosen', () => {
    // Colour is the entire distinction; two lit pills means the editor cannot
    // tell what they are about to save.
    const wrapper = render({ form: formState({ status: 'HIDDEN' }) });

    const lit = wrapper.findAll('button').filter((b) => b.classes().some((c) => c.startsWith('bg-')));
    expect(lit).toHaveLength(2); // one status, one content rating
  });

  test('an unchosen pill is drawn as an outline, not as another colour', () => {
    const wrapper = render({ form: formState({ status: 'ACTIVE' }) });

    expect(pill(wrapper, 'segment.status.DELETED')?.classes()).toContain('text-ink-muted');
  });

  test('each status has its OWN colour, so DELETED never looks like ACTIVE', () => {
    // A segment marked deleted and one marked active are one click apart.
    const active = render({ form: formState({ status: 'ACTIVE' }) });
    const deleted = render({ form: formState({ status: 'DELETED' }) });

    expect(pill(active, 'segment.status.ACTIVE')?.classes()).not.toEqual(
      pill(deleted, 'segment.status.DELETED')?.classes(),
    );
  });

  test('clicking one selects it', async () => {
    const form = formState({ status: 'ACTIVE' });
    const wrapper = render({ form });

    await pill(wrapper, 'segment.status.HIDDEN')?.trigger('click');

    expect(form.status).toBe('HIDDEN');
  });

  test('the content rating is its own row, not a second status', async () => {
    const form = formState();
    const wrapper = render({ form });

    await pill(wrapper, 'segment.contentRating.EXPLICIT')?.trigger('click');

    expect(form.contentRating).toBe('EXPLICIT');
    expect(form.status).toBe('ACTIVE');
  });
});

describe('the rating analysis JSON', () => {
  test('leaving the field with something unparseable says so', async () => {
    const jsonErrors = reactive({ ratingAnalysis: '' });
    const wrapper = render({ form: formState({ ratingAnalysisJson: '{not json' }), jsonErrors });

    await wrapper.findAll('textarea').at(-1)?.trigger('blur');

    expect(jsonErrors.ratingAnalysis).toBe('modalSegmentEdit.invalidJson');
  });

  test('and shows the message under the field, in red', async () => {
    const wrapper = render({
      form: formState({ ratingAnalysisJson: '{not json' }),
      jsonErrors: reactive({ ratingAnalysis: 'modalSegmentEdit.invalidJson' }),
    });

    expect(wrapper.find('.text-red-400').text()).toBe('modalSegmentEdit.invalidJson');
  });

  test('valid JSON clears an error left from a previous attempt', async () => {
    // Otherwise the editor fixes the typo and the form still refuses to save.
    const jsonErrors = reactive({ ratingAnalysis: 'modalSegmentEdit.invalidJson' });
    const wrapper = render({ form: formState({ ratingAnalysisJson: '{"a":1}' }), jsonErrors });

    await wrapper.findAll('textarea').at(-1)?.trigger('blur');
    await nextTick();

    expect(jsonErrors.ratingAnalysis).toBe('');
  });

  test('an EMPTY field is not an error, since the analysis is optional', async () => {
    const jsonErrors = reactive({ ratingAnalysis: 'modalSegmentEdit.invalidJson' });
    const wrapper = render({ form: formState({ ratingAnalysisJson: '   ' }), jsonErrors });

    await wrapper.findAll('textarea').at(-1)?.trigger('blur');

    expect(jsonErrors.ratingAnalysis).toBe('');
  });
});

describe('editing an old revision', () => {
  test('says which snapshot is on screen, so nobody edits history by accident', () => {
    const wrapper = render({ activeSnapshotNumber: 4 });

    expect(wrapper.text()).toContain('modalSegmentEdit.viewingSnapshot(4)');
  });

  test('offers the way back to the current text', async () => {
    const wrapper = render({ activeSnapshotNumber: 4 });

    await wrapper
      .findAll('button')
      .find((b) => b.text().trim() === 'modalSegmentEdit.current')
      ?.trigger('click');

    expect(wrapper.emitted('restore-current')).toHaveLength(1);
  });

  test('and neither appears while the current text is what is being edited', () => {
    // Snapshot 0 is a real revision number, so the flag has to be the null
    // check rather than a truthiness test.
    const wrapper = render({ activeSnapshotNumber: null });

    expect(wrapper.text()).not.toContain('modalSegmentEdit.viewingSnapshot');
  });

  test('snapshot ZERO is still a snapshot', () => {
    const wrapper = render({ activeSnapshotNumber: 0 });

    expect(wrapper.text()).toContain('modalSegmentEdit.viewingSnapshot(0)');
  });
});

describe('a save that failed', () => {
  test('shows the reason where the editor is looking', () => {
    const wrapper = render({ errorMessage: 'the segment moved' });

    expect(wrapper.text()).toContain('the segment moved');
  });

  test('and nothing at all when there is no reason to show', () => {
    // An empty red box above the form reads as an error nobody can name.
    const wrapper = render({ errorMessage: '' });

    expect(wrapper.find('.bg-red-900\\/20').exists()).toBe(false);
  });
});
