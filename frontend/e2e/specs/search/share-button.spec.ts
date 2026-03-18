import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Share button', () => {
  test('clicking share copies a sentence URL to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();


    const card = search.segmentCards.first();
    const shareButton = card.locator('button[title="Share"]');
    await shareButton.click();

    // Verify a toast notification appears
    const toast = page.locator('.Vue-Toastification__toast');
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Verify the clipboard contains a sentence URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/\/sentence\//);
  });
});
