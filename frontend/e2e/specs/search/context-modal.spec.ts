import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Context modal', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

  });

  test('clicking Context button opens the modal', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('#nd-vertically-centered-scrollable-context');
    await expect(modal).toBeVisible({ timeout: 10_000 });
  });

  test('context modal displays surrounding sentences', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('#nd-vertically-centered-scrollable-context');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // The modal renders segment cards using SearchSegmentContainer
    const modalCards = modal.locator('.group.flex.flex-col');
    await expect(modalCards.first()).toBeVisible({ timeout: 10_000 });

    const cardCount = await modalCards.count();
    expect(cardCount).toBeGreaterThan(1);
  });

  test('context modal has a title with media name', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('#nd-vertically-centered-scrollable-context');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const title = modal.locator('h3').first();
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
  });

  test('context modal can be closed', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('#nd-vertically-centered-scrollable-context').first();
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const closeButton = modal.locator('button[data-nd-overlay="#nd-vertically-centered-scrollable-context"]');
    await closeButton.click();

    await expect(modal).not.toBeVisible();
  });
});
