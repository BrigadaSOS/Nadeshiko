import { test, expect } from '../fixtures';

test.describe('Legacy URL redirects', () => {
  test.describe('search query param to path-based', () => {
    test('/search/sentence?query=彼女 → /search/彼女', async ({ page }) => {
      await page.goto('/search/sentence?query=彼女');
      await expect(page).toHaveURL(/\/search\/%E5%BD%BC%E5%A5%B3$/);
    });

    test('/search?query=school → /search/school', async ({ page }) => {
      await page.goto('/search?query=school');
      await expect(page).toHaveURL(/\/search\/school$/);
    });

    test('/search/sentence (no query) → /search', async ({ page }) => {
      await page.goto('/search/sentence');
      await expect(page).toHaveURL(/\/search$/);
    });

    test('/search/sentence/ (trailing slash) → /search', async ({ page }) => {
      await page.goto('/search/sentence/');
      await expect(page).toHaveURL(/\/search$/);
    });

    test('preserves extra query params after redirect', async ({ page }) => {
      await page.goto('/search/sentence?query=学校&category=anime');
      await expect(page).toHaveURL(/\/search\/.+\?category=anime$/);
    });
  });

  test.describe('uuid redirects', () => {
    test('/search/sentence?uuid=abc → /sentence/abc', async ({ page }) => {
      const response = await page.goto('/search/sentence?uuid=test-uuid-123');
      const redirectChain = response?.request().redirectedFrom();
      await expect(page).toHaveURL(/\/sentence\/test-uuid-123/);
    });

    test('/search?uuid=abc → /sentence/abc', async ({ page }) => {
      await page.goto('/search?uuid=test-uuid-456');
      await expect(page).toHaveURL(/\/sentence\/test-uuid-456/);
    });
  });

  test.describe('media page redirect', () => {
    test('/search/media → /media', async ({ page }) => {
      await page.goto('/search/media');
      await expect(page).toHaveURL(/\/media$/);
    });

    test('/search/media/ (trailing slash) → /media', async ({ page }) => {
      await page.goto('/search/media/');
      await expect(page).toHaveURL(/\/media$/);
    });

    test('/search/media?query=steins → /media?query=steins', async ({ page }) => {
      await page.goto('/search/media?query=steins');
      await expect(page).toHaveURL(/\/media\?query=steins$/);
    });
  });

  test.describe('legacy query param normalization', () => {
    test('mediaId → media', async ({ page }) => {
      await page.goto('/search/学校?mediaId=abc123');
      await expect(page).toHaveURL(/media=abc123/);
      await expect(page).not.toHaveURL(/mediaId/);
    });

    test('episodeId → episode', async ({ page }) => {
      await page.goto('/search/学校?episodeId=5');
      await expect(page).toHaveURL(/episode=5/);
      await expect(page).not.toHaveURL(/episodeId/);
    });
  });

  test.describe('short URLs', () => {
    test('/s/:id → /sentence/:id', async ({ page }) => {
      await page.goto('/s/test-short-id');
      await expect(page).toHaveURL(/\/sentence\/test-short-id/);
    });
  });
});
