// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * The batch word-check modal: paste a list, see which words the corpus has.
 *
 * The summary line above the table is arithmetic over two refs that are updated
 * at DIFFERENT moments -- `showResults` before the request, the totals only
 * after it succeeds -- which is the shape that produces a rendered `NaN`.
 */
const sdk = { searchWords: vi.fn() };
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('useLocalePath', () => (path: string) => `/en${path}`);

import ModalBatch from './ModalBatch.vue';

const mounted: { unmount: () => void }[] = [];

/** Opens the modal with `words` already typed into the box. */
async function openWith(words: string[]) {
  const wrapper = mount(ModalBatch, {
    props: { open: true },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, BaseModal: false },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);

  await wrapper.find('textarea').setValue(words.join('\n'));
  await nextTick();
  return wrapper;
}

/**
 * Runs the search the way the reader does, by pressing submit.
 *
 * Matched on the exact key rather than a prefix: `batchSearch.close` sits beside
 * it, and a loose match finds the wrong control, leaves the modal on its input
 * panel, and makes every assertion below pass by never rendering anything.
 */
async function search(wrapper: Awaited<ReturnType<typeof openWith>>) {
  const submit = wrapper.findAll('button').find((button) => button.text().trim() === 'batchSearch.search');
  if (!submit) throw new Error('the submit button was not found; the modal is not on its input panel');
  await submit.trigger('click');
  await nextTick();
  await nextTick();
  await nextTick();
}

/** A `searchWords` reply where `matched` of the words were found. */
function reply(words: string[], matched: number) {
  return {
    results: words.map((word, index) => ({ word, isMatch: index < matched, matchCount: index < matched ? 5 : 0 })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.searchWords.mockResolvedValue(reply(['a'], 1));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('a successful check', () => {
  test('reports what share of the pasted words the corpus has', async () => {
    const words = ['食べる', '飲む', '走る', '泳ぐ'];
    sdk.searchWords.mockResolvedValue(reply(words, 3));
    const wrapper = await openWith(words);

    await search(wrapper);

    expect(wrapper.text()).toContain('75.00%');
  });

  test('reports 0.00% when the corpus has none of them', async () => {
    const words = ['食べる', '飲む'];
    sdk.searchWords.mockResolvedValue(reply(words, 0));
    const wrapper = await openWith(words);

    await search(wrapper);

    expect(wrapper.text()).toContain('0.00%');
  });
});

describe('a check that FAILED', () => {
  beforeEach(() => {
    sdk.searchWords.mockRejectedValue(new Error('offline'));
  });

  test('tells the reader it went wrong', async () => {
    const wrapper = await openWith(['食べる', '飲む']);

    await search(wrapper);

    expect(handleApiError).toHaveBeenCalledWith(
      'search:batch-words-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: expect.any(String) }),
    );
  });

  test('returns to the input, with the reader’s words still in the box to retry', async () => {
    const wrapper = await openWith(['食べる', '飲む']);

    await search(wrapper);

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toContain('食べる');
  });

  test('does NOT render a NaN percentage', async () => {
    // `showResults` is set before the request and the totals only after it
    // succeeds, so a failure leaves the results panel on screen dividing zero
    // by zero. The reader is shown "percentage matched: NaN%" beside a toast
    // saying the search failed.
    const wrapper = await openWith(['食べる', '飲む']);

    await search(wrapper);

    expect(wrapper.text()).not.toContain('NaN');
  });
});

describe('a failed check after a successful one', () => {
  test('does not show the PREVIOUS search’s results as if they were these', async () => {
    // `wordsMatch` is only assigned inside the `try`, so a failure leaves the
    // last successful search's rows in the table -- under a word count taken
    // from the new list. The reader is shown ten results for a three-word check.
    const first = ['食べる', '飲む', '走る', '泳ぐ'];
    sdk.searchWords.mockResolvedValue(reply(first, 4));
    const wrapper = await openWith(first);
    await search(wrapper);
    expect(wrapper.text()).toContain('100.00%');

    // Back to the input panel first: the textarea only exists there.
    const back = wrapper.findAll('button').find((b) => b.text().trim() === 'batchSearch.results.return');
    await back?.trigger('click');
    await nextTick();

    sdk.searchWords.mockRejectedValue(new Error('offline'));
    await wrapper.find('textarea').setValue('新しい');
    await nextTick();
    await search(wrapper);

    expect(wrapper.text()).not.toContain('100.00%');
  });
});
