// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive } from 'vue';
import type { Definition } from '@shirabe-org/card/word-card';
import type { EnrichedToken } from '~/utils/tokenEnrichment';
import type { SearchResult } from '~/types/search';

const anki = reactive({
  activeProfile: {
    deck: 'Mining',
    model: 'Lapis',
    key: 'Expression',
    fields: [{ key: 'Expression', value: '{word}' }],
  },
  connectReachable: null as boolean | null,
  addResultToAnki: vi.fn(),
  executeAction: vi.fn().mockResolvedValue({ result: [] }),
  guiBrowse: vi.fn(),
});
const user = reactive({ isLoggedIn: true });
const push = vi.fn();
const openLoginModal = vi.fn();
vi.mock('~/stores/anki', () => ({ ankiStore: () => anki }));
vi.mock('~/stores/auth', () => ({ userStore: () => user }));
vi.stubGlobal('useLoginModal', () => ({ openLoginModal }));
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useRouter', () => ({ push, resolve: ({ path }: { path: string }) => ({ href: path }) }));
vi.stubGlobal('useLocalePath', () => (path: string) => path);
vi.stubGlobal('useRoute', () => ({ query: {} }));

import NadeshikoWordCardActions from './NadeshikoWordCardActions.vue';

const token = { s: '食べた', b: 0, e: 3, dictForm: '食べる', readingHiragana: 'たべた' } as EnrichedToken;
const result = { segment: { textJa: { content: '食べた' } } } as SearchResult;
const shownDefinition: Definition = {
  entry: 'jmdict:1',
  headword: '食べる',
  reading: 'たべる',
  url: 'https://shirabe.org/en/word/jmdict%3A1',
  common: true,
  jlpt: null,
  frequency: null,
  pitch: [],
  senses: [],
  examples: [],
};
const render = (definition: Definition | null = shownDefinition) =>
  mount(NadeshikoWordCardActions, { props: { token, result, definition } });

beforeEach(() => {
  vi.clearAllMocks();
  anki.executeAction.mockResolvedValue({ result: [] });
  user.isLoggedIn = true;
  anki.connectReachable = null;
  anki.activeProfile = {
    deck: 'Mining',
    model: 'Lapis',
    key: 'Expression',
    fields: [{ key: 'Expression', value: '{word}' }],
  };
});

describe('Nadeshiko actions mounted in the Shirabe card', () => {
  test('waits for a rendered definition, then mines a new word directly', async () => {
    const wrapper = render(null);
    const add = wrapper.get('[data-testid="word-anki-add"]');
    expect(add.attributes('disabled')).toBeDefined();
    await add.trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await wrapper.setProps({ definition: shownDefinition });
    expect(add.attributes('disabled')).toBeUndefined();
    await add.trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(anki.addResultToAnki).toHaveBeenCalledWith(
      result,
      expect.objectContaining({ wordFields: true, create: true }),
    );
    wrapper.unmount();
  });

  test('keeps word search beside the direct Anki action', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="word-more-sentences"]').trigger('click');
    expect(wrapper.emitted('search')).toEqual([['食べる']]);
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test('mines the selected word through Nadeshiko and opens an existing note', async () => {
    anki.executeAction.mockResolvedValue({ result: [42] });
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="word-anki-last"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="word-anki-search"]').exists()).toBe(false);
    await wrapper.get('[data-testid="word-anki-open"]').trigger('click');
    expect(anki.guiBrowse).toHaveBeenCalledWith('nid:42');
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    await wrapper.get('[data-testid="word-anki-context"]').trigger('click');
    await flushPromises();
    expect(anki.addResultToAnki).toHaveBeenCalledWith(
      result,
      expect.objectContaining({ noteId: 42, wordFields: false }),
    );
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    await wrapper.get('[data-testid="word-anki-mine"]').trigger('click');
    await flushPromises();
    expect(anki.addResultToAnki).toHaveBeenCalledWith(
      result,
      expect.objectContaining({ noteId: 42, wordFields: true }),
    );
    wrapper.unmount();
  });

  test('waits for the Anki probe before deciding whether to show the existing-note menu', async () => {
    let answer!: (value: { result: number[] }) => void;
    anki.executeAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const wrapper = render();
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    expect(wrapper.get('[data-testid="word-anki-add"]').attributes('disabled')).toBeDefined();
    expect(anki.addResultToAnki).not.toHaveBeenCalled();

    answer({ result: [42] });
    await flushPromises();
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3);
    expect(anki.addResultToAnki).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('sends unconfigured readers to Anki settings', async () => {
    anki.activeProfile.deck = '';
    const wrapper = render();
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    await flushPromises();
    expect(push).toHaveBeenCalledWith('/user/sync');
    expect(anki.addResultToAnki).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test('uses the existing login action for signed-out readers', async () => {
    user.isLoggedIn = false;
    const wrapper = render();
    await wrapper.get('[data-testid="word-anki-add"]').trigger('click');
    expect(openLoginModal).toHaveBeenCalledWith('anki_add_last');
    wrapper.unmount();
  });
});
