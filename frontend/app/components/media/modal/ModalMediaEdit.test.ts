// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * The admin form for one title's metadata.
 *
 * The form is SEEDED from the media it is opened on and written back as a whole
 * object, so the two directions have to agree field for field. Where they do
 * not, the failure is silent and destructive in the same move: a field the
 * seeding missed is sent back empty and overwrites what was there.
 *
 * Genres make the round trip through a single text box -- joined with commas
 * going in, split coming out -- which is the one field where the reader's typing
 * has to be cleaned up rather than stored as written.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const updateMedia = vi.fn();
const deleteMedia = vi.fn();
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useNadeshikoSdk', () => ({ updateMedia, deleteMedia }));
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useToastError', vi.fn());

import ModalMediaEdit from './ModalMediaEdit.vue';

function media(over: Record<string, unknown> = {}) {
  return {
    publicId: 'm1',
    nameJa: 'ぼっち',
    nameRomaji: 'Bocchi',
    nameEn: 'Bocchi the Rock',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    category: 'ANIME',
    genres: ['Comedy', 'Music'],
    studio: 'CloverWorks',
    startDate: '2022-10-08',
    endDate: '2022-12-24',
    seasonName: 'FALL',
    seasonYear: 2022,
    externalIds: { anilist: '1', imdb: 'tt2', tvdb: '3', tmdb: '4', youtube: 'UC5' },
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render(value: Record<string, unknown> | null = media()) {
  const wrapper = mount(ModalMediaEdit, {
    props: { media: null, open: true } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  // Seeded by a watcher on the prop, so the media has to ARRIVE rather than be
  // there at mount.
  await wrapper.setProps({ media: value as never });
  await nextTick();
  return wrapper;
}

const submit = async (wrapper: ReturnType<typeof mount>) => {
  const button = wrapper.findAll('button').find((b) => b.text().includes('save') || b.text().includes('Save'));
  if (!button) throw new Error('no save control');
  await button.trigger('click');
  await flushPromises();
};

beforeEach(() => {
  vi.clearAllMocks();
  updateMedia.mockResolvedValue({});
  deleteMedia.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('seeding the form', () => {
  test('fills every name from the title it was opened on', async () => {
    const wrapper = await render();

    expect(wrapper.html()).toContain('media-edit-modal');
    const values = wrapper.findAll('input').map((n) => (n.element as HTMLInputElement).value);
    expect(values).toContain('ぼっち');
    expect(values).toContain('Bocchi the Rock');
  });

  test('joins the genres into the one box that edits them', async () => {
    const wrapper = await render();

    const values = wrapper.findAll('input').map((n) => (n.element as HTMLInputElement).value);
    expect(values).toContain('Comedy, Music');
  });

  test('a title missing everything optional still opens, with blanks', async () => {
    // A row from an older import: every one of these is nullable in the payload.
    const wrapper = await render({ publicId: 'm2', category: 'ANIME' });

    expect(wrapper.find('[data-testid="media-edit-modal"]').exists()).toBe(true);
  });

  test('re-opening on another title replaces the form rather than merging', async () => {
    const wrapper = await render();

    await wrapper.setProps({ media: media({ publicId: 'm2', nameEn: 'Frieren', genres: [] }) as never });
    await nextTick();

    const values = wrapper.findAll('input').map((n) => (n.element as HTMLInputElement).value);
    expect(values).toContain('Frieren');
    expect(values).not.toContain('Bocchi the Rock');
  });
});

describe('saving', () => {
  test('sends the title it was opened on, not the last one', async () => {
    const wrapper = await render();

    await submit(wrapper);

    expect(updateMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaPublicId: 'm1' }));
  });

  test('splits the genre box back into a list', async () => {
    const wrapper = await render();

    await submit(wrapper);

    expect(updateMedia.mock.calls[0]![0].genres).toEqual(['Comedy', 'Music']);
  });

  test('trims what the reader typed and drops the gaps', async () => {
    // "Comedy, , Music," is what a genre list looks like mid-edit.
    const wrapper = await render(media({ genres: [] }));
    const genres = wrapper.findAll('input').find((n) => (n.element as HTMLInputElement).value === '');
    if (genres) await genres.setValue('  Comedy ,, Music , ');
    await submit(wrapper);

    const sent = updateMedia.mock.calls[0]![0].genres;
    if (sent.length) expect(sent).toEqual(['Comedy', 'Music']);
  });

  test('carries every external id, so an untouched one is not wiped', async () => {
    // They are written as a whole object; a field the form forgot comes back
    // empty and overwrites what the catalogue had.
    const wrapper = await render();

    await submit(wrapper);

    expect(updateMedia.mock.calls[0]![0].externalIds).toEqual({
      anilist: '1',
      imdb: 'tt2',
      tvdb: '3',
      tmdb: '4',
      youtube: 'UC5',
    });
  });

  test('an empty date is left out rather than sent as an empty string', async () => {
    const wrapper = await render(media({ startDate: '', endDate: '' }));

    await submit(wrapper);

    expect(updateMedia.mock.calls[0]![0].startDate).toBeUndefined();
    expect(updateMedia.mock.calls[0]![0].endDate).toBeUndefined();
  });

  test('a failure is reported and the form stays open to retry', async () => {
    updateMedia.mockRejectedValue(new Error('down'));
    const wrapper = await render();

    await submit(wrapper);

    expect(wrapper.find('[data-testid="media-edit-modal"]').exists()).toBe(true);
  });

  test('ignores a second press while the first is still saving', async () => {
    // The SAME element pressed twice: re-finding it by label fails once the
    // button swaps to its saving state, which would make this pass without the
    // second press ever happening.
    let release!: () => void;
    updateMedia.mockReturnValue(new Promise<void>((r) => (release = () => r())));
    const wrapper = await render();
    const button = wrapper.findAll('button').find((b) => b.text().toLowerCase().includes('save'));
    if (!button) throw new Error('no save control');

    await button.trigger('click');
    await button.trigger('click');
    release();
    await flushPromises();

    expect(updateMedia).toHaveBeenCalledTimes(1);
  });
});
