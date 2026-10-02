import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { locales, publishSnapshot, readPublished } from '../../scripts/publish-sitemaps.mjs';
import { publishedSitemap, sitemapSnapshotFile } from './sitemapSnapshot';

const roots: string[] = [];
async function root() {
  const dir = await mkdtemp(join(tmpdir(), 'sitemap-test-'));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function output(slug = 'first') {
  const index = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locales.map((l) => `<sitemap><loc>https://nadeshiko.co/__sitemap__/${l}.xml</loc></sitemap>`).join('')}</sitemapindex>`;
  return {
    'sitemap.xml': index,
    'sitemap_index.xml': index,
    ...Object.fromEntries(
      locales.map((l) => [
        `${l}.xml`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://nadeshiko.co/${l}/media/${slug}</loc></url></urlset>`,
      ]),
    ),
  };
}

describe('persistent sitemap publication', () => {
  it('reuses the published set without generation, even from a new caller', async () => {
    const dir = await root();
    const generate = vi.fn(async () => output());
    await publishSnapshot(dir, generate);
    const before = await readFile(join(dir, 'current.json'), 'utf8');
    await publishSnapshot(dir, generate);
    const later = vi.fn(async () => output('later'));
    await publishSnapshot(dir, later);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(await readFile(join(dir, 'current.json'), 'utf8')).toBe(before);
    const file = await publishedSitemap(dir, 'en.xml');
    expect(await readFile(file.path, 'utf8')).toContain('/media/first');
  });
  it('keeps the old complete set visible during refresh and after a failed refresh', async () => {
    const dir = await root();
    await publishSnapshot(dir, async () => output());
    const original = await readFile(join(dir, 'current.json'), 'utf8');
    await expect(
      publishSnapshot(
        dir,
        async () => {
          expect(await readFile(join(dir, 'current.json'), 'utf8')).toBe(original);
          return { ...output('new'), 'pt-BR.xml': 'broken' };
        },
        { refresh: true },
      ),
    ).rejects.toThrow('Invalid sitemap XML');
    expect(await readFile(join(dir, 'current.json'), 'utf8')).toBe(original);
    await expect(readPublished(dir)).resolves.toBeTruthy();
    await publishSnapshot(dir, async () => output('new'), { refresh: true });
    expect(await readFile((await publishedSitemap(dir, 'en.xml')).path, 'utf8')).toContain('/media/new');
  });
  it('allows only one generation across concurrent publishers', async () => {
    const dir = await root();
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((r) => {
      started = r;
    });
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const first = publishSnapshot(dir, async () => {
      started();
      await wait;
      return output();
    });
    await begun;
    await expect(publishSnapshot(dir, async () => output())).rejects.toThrow('already locked');
    release();
    await first;
  });
  it('rejects wrong-locale and errored output without publishing', async () => {
    const dir = await root();
    await expect(publishSnapshot(dir, async () => ({ ...output(), 'en.xml': output()['es.xml']! }))).rejects.toThrow(
      'Unexpected sitemap URL',
    );
    await expect(
      publishSnapshot(dir, async () => ({ ...output(), 'en.xml': `${output()['en.xml']}<!-- error_messages -->` })),
    ).rejects.toThrow('Invalid sitemap XML');
    expect(await readPublished(dir)).toBeNull();
  });
  it('maps only the published sitemap names', () => {
    expect(sitemapSnapshotFile('/sitemap.xml')).toBe('sitemap.xml');
    expect(sitemapSnapshotFile('/__sitemap__/pt-BR.xml')).toBe('pt-BR.xml');
    expect(sitemapSnapshotFile('/__sitemap__/../../current.json')).toBeNull();
    expect(sitemapSnapshotFile('/__sitemap__/ja.xml')).toBeNull();
  });
});
