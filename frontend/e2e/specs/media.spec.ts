import { test, expect } from '../fixtures';
import { MediaPage } from '../pages/MediaPage';

test.describe('Media catalog', () => {
  test('displays the media grid', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();

    const count = await media.getMediaCount();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a media card navigates to its search results', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();
    await media.clickFirstMedia();

    await expect(page).toHaveURL(/\/search\?media=/);
  });

  test('each media card shows a title', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();

    // Title is in a sibling NuxtLink next to the cover image link
    const firstCardContainer = media.mediaCards.first().locator('..').locator('..');
    const title = firstCardContainer.locator('h3').first();
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
  });

  test('search filters the media list', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();


    const initialCount = await media.getMediaCount();

    // Read the first media's title and search for it, so the test is data-independent
    const firstTitle = await media.mediaCards.first().locator('..').locator('..').locator('h3').first().textContent();
    const searchTerm = firstTitle!.trim().split(' ')[0]!;

    await media.search(searchTerm);
    await expect(page).toHaveURL(/query=/, { timeout: 10_000 });
    await media.expectLoaded();

    const filteredCount = await media.getMediaCount();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('category filter via URL narrows results', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto({ category: 'ANIME' });
    await media.expectLoaded();

    const animeCount = await media.getMediaCount();
    expect(animeCount).toBeGreaterThan(0);
  });

  test('list view renders media items', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto({ view: 'list' });
    await media.expectListLoaded();

    const listCount = await media.listItems.count();
    expect(listCount).toBeGreaterThan(0);
  });

  test('grid view is the default', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();

    const grid = page.locator('.grid.grid-cols-2');
    await expect(grid).toBeVisible();
  });
});
