import { test, expect } from '../fixtures';
import { HomePage } from '../pages/HomePage';

test.describe('Homepage', () => {
  test('loads and displays core elements', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.expectLoaded();
  });

  test('displays recent media', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.expectRecentMediaVisible();

    const count = await home.mediaCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('displays stats (sentences, episodes, media)', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.expectStatsVisible();
  });

  test('navigates to search page on search', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.search('学校');

    await expect(page).toHaveURL(/\/search\//);
  });

  test('clicking a media card navigates to filtered search', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();
    await home.expectRecentMediaVisible();

    await home.mediaCards.first().click();
    await expect(page).toHaveURL(/\/search\?media=/);
  });
});
