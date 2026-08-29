import { test, expect } from '../fixtures';

/**
 * The corpus statistics page, which had no spec at all.
 *
 * It is worth one because it is the site's only page whose entire content is
 * numbers computed by the backend, and every way it goes wrong is quiet: a
 * division by zero renders `NaN%`, a null aggregate renders an empty bar, and a
 * failed fetch renders a page that looks merely empty rather than broken. None
 * of those throws, so nothing but an assertion on the rendered text catches
 * them. One of them was live -- the whole-corpus tier is built from the
 * frequency list's own length, and on a database whose word list is not loaded
 * that length is 0, which the API's own response schema rejects (`minimum: 1`)
 * and turned into a 500 from a public endpoint.
 *
 * Assertions are on SHAPE -- a number is rendered, a percentage is between 0 and
 * 100 -- rather than on particular values, so the spec does not have to be
 * edited every time the corpus grows.
 */
test.describe('the stats page', () => {
  test('renders', async ({ page }) => {
    const response = await page.goto('/stats');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('shows the corpus totals rather than an error card', async ({ page }) => {
    // The page has a `loadError` branch that looks like a slightly empty page.
    // Reaching it means the backend answered badly, which is the failure this
    // spec exists to notice.
    await page.goto('/stats');

    await expect(page.getByText(/could not|error/i).first()).toBeHidden();
    await expect(page.getByRole('heading', { name: /coverage/i })).toBeVisible();
  });

  test('every summary figure is an actual number', async ({ page }) => {
    // A null aggregate renders as an empty tile, which reads as "we have no
    // sentences" rather than as a broken query.
    await page.goto('/stats');

    const figures = page.locator('p.text-3xl');
    await expect(figures.first()).toBeVisible();

    const count = await figures.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i++) {
      const text = (await figures.nth(i).innerText()).replace(/[+,\s]/g, '');
      expect(text).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  test('no figure on the page is NaN', async ({ page }) => {
    // The literal failure mode of every ratio here: `enHuman / enTotal` with
    // both zero. It renders, it does not throw, and it says `NaN%`.
    await page.goto('/stats');

    await expect(page.locator('body')).not.toContainText('NaN');
    await expect(page.locator('body')).not.toContainText('Infinity');
  });

  test('every coverage percentage is between 0 and 100', async ({ page }) => {
    // The bar width is set straight from this, so a value outside the range is
    // a bar that overflows its container or disappears.
    await page.goto('/stats');

    const percentages = page.locator('span.text-button-accent-main');
    await expect(percentages.first()).toBeVisible();

    const count = await percentages.count();
    for (let i = 0; i < count; i++) {
      const text = await percentages.nth(i).innerText();
      if (!text.includes('%')) continue;
      const value = Number.parseFloat(text.replace(/[%,]/g, ''));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  test('lists the frequency tiers, each linking to its word list', async ({ page }) => {
    await page.goto('/stats');

    const tierLinks = page.locator('a[href*="/stats/words?tier="]');
    await expect(tierLinks.first()).toBeVisible();
    expect(await tierLinks.count()).toBeGreaterThan(1);
  });

  test('a tier link opens the word list for that tier', async ({ page }) => {
    await page.goto('/stats');

    await page.locator('a[href*="/stats/words?tier="]').first().click();

    await expect(page).toHaveURL(/\/stats\/words\?tier=\d+/);
  });

  test('shows the translation availability breakdown', async ({ page }) => {
    await page.goto('/stats');

    await expect(page.getByRole('heading', { name: /translation/i })).toBeVisible();
  });

  test('is served in Spanish too', async ({ page }) => {
    // The whole page is interpolated numbers inside translated strings, which
    // is where a missing key shows up as a raw `statsPage.foo.bar`.
    await page.goto('/es/stats');

    await expect(page.locator('body')).not.toContainText('statsPage.');
  });
});

test.describe('the covered-words list', () => {
  test('renders for a tier', async ({ page }) => {
    const response = await page.goto('/stats/words?tier=1000');

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('does not fall over on a tier nobody has words in', async ({ page }) => {
    // The tier comes straight off the query string, so it is reader input.
    const response = await page.goto('/stats/words?tier=999999999');

    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).not.toContainText('NaN');
  });
});
