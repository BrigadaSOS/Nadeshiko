import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';
import type { Page, Response } from '@playwright/test';

function recordSearchRequests(page: Page) {
  const calls: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (path === '/v1/search' || path === '/v1/search/stats')) {
      calls.push(path);
    }
  });
  return () => [...calls].sort();
}

const schoolRequests = ['/v1/search', '/v1/search/stats'];

async function expectStatsRendered(page: Page, response: Response) {
  expect(response.status()).toBe(200);
  const data = await response.json();
  const anime = data.categories.find((row: { category: string }) => row.category === 'ANIME');
  expect(anime.category).toBe('ANIME');
  await expect(page.getByTestId('search-category-tab-anime').locator('span').nth(1)).toHaveText(String(anime.count));
}

function nextStatsResponse(page: Page) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/v1/search/stats' && response.request().method() === 'POST',
  );
}

test('search hydration reuses the server-rendered results', async ({ page }) => {
  const calls = recordSearchRequests(page);
  const search = new SearchPage(page);
  await search.goto('彼女', { locale: 'en' });
  await search.expectResultsVisible();

  await expect(page.getByTestId('segment-japanese-text').first()).toContainText('彼女');
  await expect(search.searchInput).toHaveValue('彼女');
  expect(calls()).toEqual([]);
});

test('changing the word path fetches one new result set without a duplicate pair', async ({ page }) => {
  const search = new SearchPage(page);
  await search.goto('彼女', { locale: 'en' });
  await search.expectResultsVisible();
  const calls = recordSearchRequests(page);

  const statsResponse = nextStatsResponse(page);
  await search.search('学校');
  await expectStatsRendered(page, await statsResponse);
  await expect(page.getByTestId('segment-japanese-text').first()).toContainText('学校');
  await expect(search.searchInput).toHaveValue('学校');
  expect(calls()).toEqual(schoolRequests);
});

test('resubmitting the same URL refreshes results and stats', async ({ page }) => {
  const search = new SearchPage(page);
  await search.goto('学校', { locale: 'en' });
  await search.expectResultsVisible();
  const calls = recordSearchRequests(page);

  const statsResponse = nextStatsResponse(page);
  await search.searchButton.click();
  await expectStatsRendered(page, await statsResponse);
  await expect.poll(calls).toEqual(schoolRequests);
  await expect(page.getByTestId('segment-japanese-text').first()).toContainText('学校');
  await expect(search.searchInput).toHaveValue('学校');
});

test('category navigation keeps the word and applies the new scope once', async ({ page }) => {
  const search = new SearchPage(page);
  await search.goto('学校', { locale: 'en' });
  await search.expectResultsVisible();
  const calls = recordSearchRequests(page);

  const statsResponse = nextStatsResponse(page);
  await page.getByTestId('search-category-tab-anime').click();
  await expectStatsRendered(page, await statsResponse);
  await expect(page).toHaveURL(/\?category=anime$/);
  await expect.poll(calls).toEqual(schoolRequests);
  await expect(page.getByTestId('search-category-tab-anime')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('segment-japanese-text').first()).toContainText('学校');
  await expect(search.searchInput).toHaveValue('学校');
});
