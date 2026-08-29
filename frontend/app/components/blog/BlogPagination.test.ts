// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import BlogPagination from './BlogPagination.vue';

/**
 * The first component test in the repo, and the pattern the next one should
 * copy: mount the SFC, stub the two Nuxt globals it cannot see under plain
 * vitest, and assert what a reader would notice.
 *
 * `NuxtLink` becomes a plain anchor so `to` is readable as `href`; `$t` returns
 * the key so a copy change never breaks a structural assertion.
 */
function renderPagination(props: { currentPage: number; totalPages: number; basePath?: string }) {
  return mount(BlogPagination, {
    props: { basePath: '/blog', ...props },
    global: {
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
      mocks: { $t: (key: string) => key },
    },
  });
}

/** The page buttons in order, with ellipses as literal '...'. */
function pageLabels(wrapper: ReturnType<typeof renderPagination>): string[] {
  return wrapper
    .findAll('nav > *')
    .map((el) => el.text())
    .filter((text) => !['blog.pagination.previous', 'blog.pagination.next'].includes(text));
}

describe('which pages are offered', () => {
  it('lists every page when there are few enough to show them all', () => {
    expect(pageLabels(renderPagination({ currentPage: 1, totalPages: 7 }))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });

  it('collapses the tail once the list grows past seven', () => {
    expect(pageLabels(renderPagination({ currentPage: 1, totalPages: 20 }))).toEqual(['1', '2', '...', '20']);
  });

  it('collapses both ends when the reader is in the middle', () => {
    expect(pageLabels(renderPagination({ currentPage: 10, totalPages: 20 }))).toEqual([
      '1',
      '...',
      '9',
      '10',
      '11',
      '...',
      '20',
    ]);
  });

  it('collapses only the head near the end', () => {
    expect(pageLabels(renderPagination({ currentPage: 20, totalPages: 20 }))).toEqual(['1', '...', '19', '20']);
  });

  it('always offers the first and last page, wherever the reader is', () => {
    for (const currentPage of [1, 2, 5, 12, 19, 20]) {
      const labels = pageLabels(renderPagination({ currentPage, totalPages: 20 }));
      expect(labels[0]).toBe('1');
      expect(labels.at(-1)).toBe('20');
    }
  });

  it('never repeats a page number', () => {
    for (const currentPage of [1, 2, 3, 4, 10, 17, 18, 19, 20]) {
      const numbers = pageLabels(renderPagination({ currentPage, totalPages: 20 })).filter((l) => l !== '...');
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });
});

describe('previous and next', () => {
  it('hides previous on the first page', () => {
    const wrapper = renderPagination({ currentPage: 1, totalPages: 5 });

    expect(wrapper.text()).not.toContain('blog.pagination.previous');
    expect(wrapper.text()).toContain('blog.pagination.next');
  });

  it('hides next on the last page', () => {
    const wrapper = renderPagination({ currentPage: 5, totalPages: 5 });

    expect(wrapper.text()).toContain('blog.pagination.previous');
    expect(wrapper.text()).not.toContain('blog.pagination.next');
  });

  it('offers both in the middle, pointing one page either side', () => {
    const wrapper = renderPagination({ currentPage: 3, totalPages: 5 });
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'));

    expect(hrefs).toContain('/blog?page=2');
    expect(hrefs).toContain('/blog?page=4');
  });

  it('hides both when there is only one page', () => {
    const wrapper = renderPagination({ currentPage: 1, totalPages: 1 });

    expect(wrapper.text()).not.toContain('blog.pagination.previous');
    expect(wrapper.text()).not.toContain('blog.pagination.next');
  });
});

describe('links and accessibility', () => {
  it('builds every link off the base path it was given', () => {
    const wrapper = renderPagination({ currentPage: 2, totalPages: 4, basePath: '/es/blog' });

    for (const href of wrapper.findAll('a').map((a) => a.attributes('href'))) {
      expect(href).toMatch(/^\/es\/blog\?page=\d+$/);
    }
  });

  it('marks the current page for screen readers, and only that one', () => {
    const wrapper = renderPagination({ currentPage: 3, totalPages: 5 });
    const current = wrapper.findAll('[aria-current="page"]');

    expect(current).toHaveLength(1);
    expect(current[0]?.text()).toBe('3');
  });

  it('labels the nav landmark', () => {
    const wrapper = renderPagination({ currentPage: 1, totalPages: 3 });

    expect(wrapper.find('nav').attributes('aria-label')).toBe('blog.pagination.label');
  });

  it('renders an ellipsis as text, never as a link to nowhere', () => {
    const wrapper = renderPagination({ currentPage: 10, totalPages: 20 });
    const ellipses = wrapper.findAll('span').filter((el) => el.text() === '...');

    expect(ellipses.length).toBeGreaterThan(0);
    for (const el of ellipses) expect(el.element.tagName).toBe('SPAN');
  });
});
