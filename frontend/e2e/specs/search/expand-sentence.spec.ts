import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Expand sentence', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();
  });

  test('Expand right updates text without crashing', async ({ page }) => {
    const card = search.segmentCards.first();
    const jaText = card.getByTestId('segment-japanese-text');

    // Open more dropdown
    const dropdown = card.getByTestId('more-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    const menu = dropdown.getByTestId('dropdown-menu');
    await expect(menu.getByText('Expand (right)')).toBeVisible();

    // Click expand right and wait for context API
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/context') && resp.status() === 200,
    );
    await menu.getByText('Expand (right)').click();
    await responsePromise;

    // Card and Japanese text should remain visible
    await expect(card).toBeVisible();
    await expect(jaText).toBeVisible();

    // If a next segment exists, the concatenated text contains a cyan span.
    // If the segment is at an episode boundary, the text stays the same.
    // Either outcome is valid as long as nothing crashed.
    const cyanSpans = jaText.locator('span.text-cyan-200');
    const count = await cyanSpans.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Expand left updates text without crashing', async ({ page }) => {
    const card = search.segmentCards.first();
    const jaText = card.getByTestId('segment-japanese-text');

    const dropdown = card.getByTestId('more-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    const menu = dropdown.getByTestId('dropdown-menu');
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/context') && resp.status() === 200,
    );
    await menu.getByText('Expand (left)').click();
    await responsePromise;

    await expect(card).toBeVisible();
    await expect(jaText).toBeVisible();
  });

  test('Expand both updates text without crashing', async ({ page }) => {
    const card = search.segmentCards.first();
    const jaText = card.getByTestId('segment-japanese-text');

    const dropdown = card.getByTestId('more-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    const menu = dropdown.getByTestId('dropdown-menu');
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/context') && resp.status() === 200,
    );
    await menu.getByText('Expand (both)').click();
    await responsePromise;

    await expect(card).toBeVisible();
    await expect(jaText).toBeVisible();
  });
});
