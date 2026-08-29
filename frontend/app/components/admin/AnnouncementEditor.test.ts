// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

/**
 * The site-wide announcement banner's editor.
 *
 * Everything this writes is shown to every reader at once, so the guards matter
 * more than the form does. Save is held shut until something has actually
 * CHANGED -- re-posting the same banner would republish it to readers who had
 * already dismissed it -- and until there is a message, because an active
 * announcement with no text is an empty bar across the top of the site.
 *
 * "No announcement configured" is the normal case and arrives as a THROWN error
 * from the fetch, so the editor has to open blank on it rather than treat it as
 * a failure -- while still reporting genuine failures, which look identical from
 * here.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const getAnnouncement = vi.fn();
const updateAnnouncement = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useNadeshikoSdk', () => ({ getAnnouncement, updateAnnouncement }));
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal(
  'useAsyncData',
  async (_k: unknown, handler: () => Promise<unknown>, opts?: { default?: () => unknown }) => {
    const data = ref<unknown>(opts?.default?.() ?? null);
    data.value = await handler();
    return { data, refresh: vi.fn(), pending: ref(false), error: ref(null) };
  },
);

import AnnouncementEditor from './AnnouncementEditor.vue';

const existing = (over: Record<string, unknown> = {}) => ({
  message: 'Scheduled maintenance tonight',
  type: 'MAINTENANCE',
  active: true,
  ...over,
});

const mounted: { unmount: () => void }[] = [];

async function render(current: Record<string, unknown> | null = null) {
  if (current === null) getAnnouncement.mockRejectedValue(new Error('none configured'));
  else getAnnouncement.mockResolvedValue(current);

  const Host = defineComponent({
    components: { AnnouncementEditor },
    template: '<Suspense><AnnouncementEditor /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { UiBaseIcon: true, NuxtLink: { props: ['to'], template: '<a><slot /></a>' } },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const messageBox = (w: ReturnType<typeof mount>) => w.get('textarea');
const buttonSaying = (w: ReturnType<typeof mount>, key: string) => {
  const b = w.findAll('button').find((n) => n.text().trim() === key);
  if (!b) throw new Error(`no button labelled ${key}`);
  return b;
};
const save = (w: ReturnType<typeof mount>) => buttonSaying(w, 'accountSettings.announcement.save');
const clear = (w: ReturnType<typeof mount>) => buttonSaying(w, 'accountSettings.announcement.deactivate');

beforeEach(() => {
  vi.clearAllMocks();
  updateAnnouncement.mockResolvedValue(existing());
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('opening the editor', () => {
  test('seeds the form from the announcement that is live', async () => {
    const wrapper = await render(existing());

    expect((messageBox(wrapper).element as HTMLTextAreaElement).value).toBe('Scheduled maintenance tonight');
  });

  test('opens BLANK when there is no announcement, which is the normal case', async () => {
    // The endpoint throws for "none configured", and treating that as a failure
    // would put an error in front of an admin who has simply never set one.
    const wrapper = await render(null);

    expect((messageBox(wrapper).element as HTMLTextAreaElement).value).toBe('');
  });

  test('but the failure is still recorded, since the two look identical here', async () => {
    await render(null);

    expect(handleApiError).toHaveBeenCalledWith(
      'admin:announcement-fetch-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: false }),
    );
  });
});

describe('the save guard', () => {
  test('is shut while nothing has changed', async () => {
    // Re-posting the same banner republishes it to readers who dismissed it.
    const wrapper = await render(existing());

    expect(save(wrapper).attributes('disabled')).toBeDefined();
  });

  test('opens once the message is edited', async () => {
    const wrapper = await render(existing());

    await messageBox(wrapper).setValue('Something else');
    await nextTick();

    expect(save(wrapper).attributes('disabled')).toBeUndefined();
  });

  test('stays shut for an empty message, even though that IS a change', async () => {
    // An active announcement with no text is an empty bar across the whole site.
    const wrapper = await render(existing());

    await messageBox(wrapper).setValue('   ');
    await nextTick();

    expect(save(wrapper).attributes('disabled')).toBeDefined();
  });

  test('and is shut on a blank editor with nothing typed yet', async () => {
    const wrapper = await render(null);

    expect(save(wrapper).attributes('disabled')).toBeDefined();
  });

  test('opens on a blank editor once something is typed', async () => {
    const wrapper = await render(null);

    await messageBox(wrapper).setValue('Heads up');
    await nextTick();

    expect(save(wrapper).attributes('disabled')).toBeUndefined();
  });
});

describe('saving', () => {
  test('sends the message trimmed, with the type and active flag', async () => {
    const wrapper = await render(existing({ active: false }));
    await messageBox(wrapper).setValue('  Heads up  ');
    await nextTick();

    await save(wrapper).trigger('click');
    await flushPromises();

    expect(updateAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Heads up', type: 'MAINTENANCE', active: false }),
    );
  });

  test('shuts the save guard again afterwards, because nothing has changed since', async () => {
    const wrapper = await render(existing());
    await messageBox(wrapper).setValue('Heads up');
    await nextTick();
    updateAnnouncement.mockResolvedValue(existing({ message: 'Heads up' }));

    await save(wrapper).trigger('click');
    await flushPromises();

    expect(save(wrapper).attributes('disabled')).toBeDefined();
  });

  test('a failure is reported and leaves the editor as it was', async () => {
    updateAnnouncement.mockRejectedValue(new Error('down'));
    const wrapper = await render(existing());
    await messageBox(wrapper).setValue('Heads up');
    await nextTick();

    await save(wrapper).trigger('click');
    await flushPromises();

    expect(handleApiError).toHaveBeenCalledWith(
      'admin:announcement-update-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: expect.any(String) }),
    );
    expect((messageBox(wrapper).element as HTMLTextAreaElement).value).toBe('Heads up');
  });
});

describe('taking one down', () => {
  test('writes it inactive rather than deleting it', async () => {
    const wrapper = await render(existing());

    await clear(wrapper).trigger('click');
    await flushPromises();

    expect(updateAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  test('is offered even when nothing has changed, unlike save', async () => {
    // Taking a live banner down is not an edit, and gating it behind one would
    // leave an admin unable to stop it.
    const wrapper = await render(existing());

    expect(clear(wrapper).attributes('disabled')).toBeUndefined();
  });
});
