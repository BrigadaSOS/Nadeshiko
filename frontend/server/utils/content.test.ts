import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();

const getItem = vi.fn(async (key: string) => files.get(key) ?? null);
const getKeys = vi.fn(async (base: string) => [...files.keys()].filter((key) => key.startsWith(base)));

// `useStorage` is a Nitro auto-import; vitest runs these utils as plain modules.
vi.stubGlobal('useStorage', () => ({ getItem, getKeys }));

const { getBlogPost, getBlogPosts, getContentPage } = await import('./content');

function markdown(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

beforeEach(() => {
  getItem.mockClear();
  getKeys.mockClear();
});

// Content is baked into serverAssets at build time, so a parse is good for the
// life of the process. The caches must cover every read path -- and must not
// grow on the ones that miss, because `locale` and `slug` arrive straight from
// the query string.
describe('content caching', () => {
  it('parses a blog post once and serves repeats from memory', async () => {
    files.set('en:blog:cached-post.md', markdown('title: Cached', 'Body text.'));

    const first = await getBlogPost('en', 'cached-post');
    const second = await getBlogPost('en', 'cached-post');

    expect(first?.title).toBe('Cached');
    expect(second).toBe(first);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('does not cache a blog post that does not exist', async () => {
    expect(await getBlogPost('en', 'no-such-post')).toBeNull();
    expect(await getBlogPost('en', 'no-such-post')).toBeNull();

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it('hides drafts without caching them', async () => {
    files.set('en:blog:draft-post.md', markdown('title: Draft\ndraft: true', 'Not ready.'));

    expect(await getBlogPost('en', 'draft-post')).toBeNull();
    expect(await getBlogPost('en', 'draft-post')).toBeNull();

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it('parses a content page once and serves repeats from memory', async () => {
    files.set('en:about.md', markdown('title: About', 'Who we are.'));

    const first = await getContentPage('en', 'about');
    const second = await getContentPage('en', 'about');

    expect(first?.title).toBe('About');
    expect(second).toBe(first);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('does not cache a content page that does not exist', async () => {
    expect(await getContentPage('en', 'no-such-page')).toBeNull();
    expect(await getContentPage('en', 'no-such-page')).toBeNull();

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it('caches a populated blog index but not an unknown locale', async () => {
    files.set('es:blog:hola.md', markdown('title: Hola', 'Contenido.'));

    expect(await getBlogPosts('es')).toHaveLength(1);
    expect(await getBlogPosts('es')).toHaveLength(1);
    expect(getKeys).toHaveBeenCalledTimes(1);

    expect(await getBlogPosts('xx')).toHaveLength(0);
    expect(await getBlogPosts('xx')).toHaveLength(0);
    expect(getKeys).toHaveBeenCalledTimes(3);
  });
});

describe('markdown rendering', () => {
  it('renders body markdown to html and keeps the raw source', async () => {
    files.set('en:blog:rendered.md', markdown('title: Rendered', '# Heading\n\nA paragraph.'));

    const post = await getBlogPost('en', 'rendered');

    expect(post?.html).toContain('<h1');
    expect(post?.html).toContain('A paragraph.');
    expect(post?.rawbody).toContain('# Heading');
  });

  it('sorts the blog index newest first', async () => {
    files.set('ja:blog:older.md', markdown('title: Older\ndate: 2024-01-01', 'Old.'));
    files.set('ja:blog:newer.md', markdown('title: Newer\ndate: 2025-01-01', 'New.'));

    const posts = await getBlogPosts('ja');

    expect(posts.map((post) => post.title)).toEqual(['Newer', 'Older']);
  });
});
