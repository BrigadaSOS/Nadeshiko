import { getSingletonHighlighter } from 'shiki';
import type { BundledLanguage, BundledTheme } from 'shiki';
import { marked } from 'marked';
import matter from 'gray-matter';

export interface ContentPage {
  title: string;
  description: string;
  html: string;
  meta: Record<string, unknown>;
}

export interface BlogPost {
  path: string;
  title: string;
  description: string;
  date: string | null;
  image: string | null;
  rawbody: string;
}

const pageCache = new Map<string, ContentPage | null>();
const blogCache = new Map<string, BlogPost[]>();

const SHIKI_THEME: BundledTheme = 'github-dark';
const SHIKI_LANGS: BundledLanguage[] = ['typescript', 'javascript', 'python', 'bash', 'shell', 'json', 'yaml'];
const SHIKI_FALLBACK_LANG: BundledLanguage = 'bash';

marked.use({
  async: true,
  walkTokens: async (token) => {
    if (token.type === 'code') {
      const hl = await getSingletonHighlighter({ themes: [SHIKI_THEME], langs: SHIKI_LANGS });
      const lang = (token.lang || '').toLowerCase();
      const safeLang = (SHIKI_LANGS as string[]).includes(lang) ? (lang as BundledLanguage) : SHIKI_FALLBACK_LANG;
      try {
        (token as unknown as Record<string, unknown>)._highlighted = hl.codeToHtml(token.text, {
          lang: safeLang,
          theme: SHIKI_THEME,
        });
      } catch {
        // fall back to default renderer
      }
    }
  },
  renderer: {
    code(token) {
      return ((token as unknown as Record<string, unknown>)._highlighted as string | undefined) ?? false;
    },
  },
});

function stripMdcDirectives(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^::\w/.test(line.trim()))
    .join('\n');
}

async function parseMarkdown(
  raw: string,
): Promise<{ frontmatter: Record<string, unknown>; html: string; rawbody: string }> {
  const { data, content } = matter(raw);
  const cleaned = stripMdcDirectives(content);
  const html = await marked.parse(cleaned);
  return { frontmatter: data, html, rawbody: raw };
}

export async function getContentPage(locale: string, slug: string): Promise<ContentPage | null> {
  const cacheKey = `${locale}:${slug}`;
  if (pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey) ?? null;
  }

  const storage = useStorage('assets:content');
  const key = `${locale}:${slug}.md`;
  const raw = await storage.getItem<string>(key);
  if (!raw) {
    pageCache.set(cacheKey, null);
    return null;
  }

  const { frontmatter, html } = await parseMarkdown(raw);
  const page: ContentPage = {
    title: (frontmatter.title as string) || '',
    description: (frontmatter.description as string) || '',
    html,
    meta: frontmatter,
  };

  pageCache.set(cacheKey, page);
  return page;
}

export async function getBlogPosts(locale: string): Promise<BlogPost[]> {
  if (blogCache.has(locale)) {
    return blogCache.get(locale) ?? [];
  }

  const storage = useStorage('assets:content');
  const keys = await storage.getKeys(`${locale}:blog`);
  const mdKeys = keys.filter((k) => k.endsWith('.md'));

  const posts: BlogPost[] = [];
  for (const key of mdKeys) {
    const raw = await storage.getItem<string>(key);
    if (!raw) continue;

    const { frontmatter, rawbody } = await parseMarkdown(raw);
    const slug = key.replace(`${locale}:blog:`, '').replace(/\.md$/, '');

    posts.push({
      path: `/blog/${slug}`,
      title: (frontmatter.title as string) || '',
      description: (frontmatter.description as string) || '',
      date: frontmatter.date ? new Date(frontmatter.date as string).toISOString() : null,
      image: (frontmatter.image as string) || null,
      rawbody,
    });
  }

  posts.sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateB - dateA;
  });

  blogCache.set(locale, posts);
  return posts;
}

export async function getBlogPost(locale: string, slug: string): Promise<(BlogPost & { html: string }) | null> {
  const storage = useStorage('assets:content');
  const key = `${locale}:blog:${slug}.md`;
  const raw = await storage.getItem<string>(key);
  if (!raw) return null;

  const { frontmatter, html, rawbody } = await parseMarkdown(raw);
  return {
    path: `/blog/${slug}`,
    title: (frontmatter.title as string) || '',
    description: (frontmatter.description as string) || '',
    date: frontmatter.date ? new Date(frontmatter.date as string).toISOString() : null,
    image: (frontmatter.image as string) || null,
    rawbody,
    html,
  };
}
