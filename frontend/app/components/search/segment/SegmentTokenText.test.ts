// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const { toggle, dismiss, prefetch } = vi.hoisted(() => ({ toggle: vi.fn(), dismiss: vi.fn(), prefetch: vi.fn() }));
vi.mock('~/utils/shirabeWordCard.client', () => ({
  toggleShirabeWordCard: toggle,
  dismissShirabeWordCard: dismiss,
  prefetchShirabeWordCard: prefetch,
  prepareShirabeWordCard: vi.fn(),
  activeShirabeCardOwner: { value: null },
}));

vi.stubGlobal('useI18n', () => ({ locale: ref('en'), t: (key: string) => key }));
vi.stubGlobal('useRuntimeConfig', () => ({ public: { shirabeSite: 'https://shirabe.test' } }));
const wordCardEpoch = ref(0);
vi.stubGlobal('useDropdownState', () => ({ closeAllDropdowns: vi.fn(), wordCardEpoch }));
vi.stubGlobal('useTranslationVisibility', () => ({ englishMode: ref('visible'), spanishMode: ref('visible') }));
vi.stubGlobal('useTranslationLanguages', () => ({ dictionaryGlossLanguages: ref(['en']) }));
vi.stubGlobal('useHiraganaVisibility', () => ({ furiganaMode: ref('visible') }));
vi.stubGlobal('useDictionaryLinks', () => ({ presets: [], isDictionaryEnabled: () => false }));
vi.stubGlobal('userStore', () => ({ preferences: { wordPopup: { definitionSize: 'LARGE' } } }));

import SegmentTokenText from './SegmentTokenText.vue';

let offset = 0;
function token(surface: string, over: Record<string, unknown> = {}) {
  const b = offset;
  offset += surface.length;
  return { s: surface, d: surface, r: surface, b, e: offset, p: '名詞', ...over };
}

const mounted: { unmount: () => void }[] = [];
function render(tokens: unknown[], result?: unknown) {
  const wrapper = mount(SegmentTokenText, {
    props: { tokens, result } as never,
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const clickableTokens = (wrapper: ReturnType<typeof render>) => wrapper.findAll('.token[role="button"]');

beforeEach(() => {
  vi.clearAllMocks();
  toggle.mockResolvedValue({ open: true, actionsTarget: null });
  offset = 0;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('the Shirabe word card in a sentence', () => {
  test('renders all tokens but only gives words a keyboard stop', () => {
    const wrapper = render([token('私'), token('は'), token('。', { p: '補助記号' }), token('猫')]);

    expect(wrapper.text()).toContain('私は。猫');
    expect(clickableTokens(wrapper)).toHaveLength(3);
    expect(wrapper.findAll('.token[tabindex="0"]')).toHaveLength(1);
    expect(wrapper.find('.token:last-child').attributes('tabindex')).toBe('-1');
  });

  test('hands parser context to the card on every result surface', () => {
    const wrapper = render([token('食べました', { d: '食べる', r: 'タベマシタ', p: '動詞' })], {
      segment: { textJa: { content: '食べました' } },
    });

    expect(clickableTokens(wrapper)[0]!.attributes()).toMatchObject({
      'data-lemma': '食べました',
      'data-surface': '食べました',
      'data-target-start': '0',
      'data-target-end': '5',
      'data-sentence': '食べました',
    });
    expect(wrapper.find('.token').classes()).not.toContain('sb-word');
    expect(document.querySelector('.token-tooltip')).toBeNull();
  });

  test('opens the shared card with reader settings and its Shirabe headword link', async () => {
    const wrapper = render([token('猫')]);
    await clickableTokens(wrapper)[0]!.trigger('click');

    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledWith(
      expect.objectContaining({
        element: clickableTokens(wrapper)[0]!.element,
        definitionSize: 'large',
        languages: ['eng'],
        host: expect.objectContaining({ lookup: expect.any(Function) }),
      }),
    );
    expect(toggle.mock.calls[0]![0].host.openHeadword).toBeUndefined();
  });

  test('prefetches a word on hover without opening the card', async () => {
    const wrapper = render([token('猫')]);
    const word = clickableTokens(wrapper)[0]!;
    await word.trigger('mouseenter');
    expect(prefetch).toHaveBeenCalledWith(word.element, expect.objectContaining({ lookup: expect.any(Function) }));
    expect(toggle).not.toHaveBeenCalled();
  });

  test('does not open on punctuation', async () => {
    const wrapper = render([token('。', { p: '補助記号' })]);
    await wrapper.find('.token').trigger('click');
    expect(toggle).not.toHaveBeenCalled();
  });

  test('arrow keys move the sentence’s single tab stop, then Enter opens that word', async () => {
    const wrapper = render([token('私'), token('猫')]);
    await clickableTokens(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' });
    await nextTick();

    expect(clickableTokens(wrapper)[1]!.attributes('tabindex')).toBe('0');
    expect(document.activeElement).toBe(clickableTokens(wrapper)[1]!.element);
    await clickableTokens(wrapper)[1]!.trigger('keydown', { key: 'Enter' });
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ element: clickableTokens(wrapper)[1]!.element }));
  });

  test('dismisses its open card when the sentence unmounts', () => {
    const wrapper = render([token('猫')]);
    wrapper.find('.token').element.classList.add('sb-word-open');
    wrapper.unmount();
    mounted.pop();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  test('dismisses its open card when another overlay opens', async () => {
    const wrapper = render([token('猫')]);
    wrapper.find('.token').element.classList.add('sb-word-open');
    wordCardEpoch.value += 1;
    await nextTick();
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
