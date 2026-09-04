import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaPathForbiddenError, isPathInside, resolveMediaFilePath } from './mediaPath';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('isPathInside', () => {
  it('checks a path boundary rather than a string prefix', () => {
    expect(isPathInside('/app/media', '/app/media/cover.webp')).toBe(true);
    expect(isPathInside('/app/media', '/app/media-secret.txt')).toBe(false);
  });
});

describe('resolveMediaFilePath', () => {
  async function mediaFixture() {
    const root = await mkdtemp(join(tmpdir(), 'nadeshiko-media-'));
    temporaryDirectories.push(root);
    const media = join(root, 'media');
    const outside = join(root, 'media-secret.txt');
    await mkdir(media);
    await writeFile(join(media, 'cover.webp'), 'cover');
    await writeFile(outside, 'secret');
    return { media, outside };
  }

  it('resolves a file below the media root', async () => {
    const { media } = await mediaFixture();
    await expect(resolveMediaFilePath(media, 'cover.webp')).resolves.toMatch(/\/media\/cover\.webp$/);
  });

  it('refuses the adjacent sibling a startsWith check would permit', async () => {
    const { media } = await mediaFixture();
    await expect(resolveMediaFilePath(media, '../media-secret.txt')).rejects.toBeInstanceOf(MediaPathForbiddenError);
  });

  it('refuses a symlink inside media that resolves outside it', async () => {
    const { media, outside } = await mediaFixture();
    await symlink(outside, join(media, 'escape.webp'));
    await expect(resolveMediaFilePath(media, 'escape.webp')).rejects.toBeInstanceOf(MediaPathForbiddenError);
  });
});
