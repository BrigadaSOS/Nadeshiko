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

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });
  });

  test('context modal displays surrounding sentences', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });

    // The modal renders segment cards using SearchSegmentContainer
    const modalCards = modal.getByTestId('segment-card');
    await expect(modalCards.first()).toBeVisible({ timeout: 10_000 });

    const cardCount = await modalCards.count();
    expect(cardCount).toBeGreaterThan(1);
  });

  test('context modal has a title with media name', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });

    const title = modal.getByTestId('context-modal-title');
    await expect(title).toBeVisible();
    await expect(title).not.toBeEmpty();
  });

  test('context modal names the media in the title and on each card', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });
    await expect(modal.getByTestId('segment-card').first()).toBeVisible({ timeout: 10_000 });

    // Regression: the request omitted `include: ['media']`, so the API dropped
    // the `includes.media` block and every media name resolved to empty.
    await expect(modal.getByTestId('context-modal-title')).not.toHaveText(/-\s*$/);
    await expect(modal.getByTestId('segment-media-name').first()).not.toBeEmpty();
  });

  test('context modal scrolls the starting segment into view', async ({ page }) => {
    const targetCard = search.segmentCards.first();
    const targetId = await targetCard.getAttribute('id');
    expect(targetId).toBeTruthy();

    await targetCard.getByRole('button', { name: 'Context' }).click();

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });
    await expect(modal.getByTestId('segment-card').first()).toBeVisible({ timeout: 10_000 });

    // Regression: the modal teleports to <body>, so `getElementById` matched the
    // page's copy of this same card and the modal never scrolled off the top.
    const centeredOffset = await modal.evaluate((el, id) => {
      const scroller = el.querySelector('.overflow-y-auto');
      const card = scroller?.querySelector(`[id="${CSS.escape(id as string)}"]`);
      if (!scroller || !card) return null;
      const c = card.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return Math.abs(c.top + c.height / 2 - (s.top + s.height / 2));
    }, targetId);

    expect(centeredOffset).not.toBeNull();
    // Roughly centred in the modal body rather than left at the top.
    expect(centeredOffset as number).toBeLessThan(150);
  });

  test('word card opens above the context modal', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });
    await expect(modal.getByTestId('segment-card').first()).toBeVisible({ timeout: 10_000 });

    // The card teleports to <body>. A z-index below the dialog left it opening
    // behind the overlay, so a click on a word in this modal looked dead.
    const tokens = modal.locator('.token-text .token[role="button"]');
    await expect(tokens.first()).toBeVisible();
    await tokens.first().click();

    const card = page.locator('.token-tooltip');
    await expect(card).toBeVisible({ timeout: 5_000 });

    const onTop = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop).toBe(true);
  });

  test('context modal can be closed', async ({ page }) => {
    const contextButton = search.segmentCards.first().getByRole('button', { name: 'Context' });
    await contextButton.click();

    const modal = page.locator('[data-testid="context-modal"]:not(.hidden)');
    await expect(modal).toHaveCount(1, { timeout: 10_000 });

    const closeButton = modal.getByTestId('context-modal-close');
    await closeButton.click();

    await expect(page.locator('[data-testid="context-modal"]:not(.hidden)')).toHaveCount(0);
  });
});
