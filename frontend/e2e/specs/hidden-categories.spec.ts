import type { Page } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../auth';

const QUERY = '学校';

/** Slug in the URL and the toggle's testid, category name in the stored preference. */
const CATEGORY_BY_SLUG = { anime: 'ANIME', liveaction: 'JDRAMA', youtube: 'YOUTUBE' } as const;
type CategorySlug = keyof typeof CATEGORY_BY_SLUG;

/**
 * Hiding a whole category, from the switch on `/user/media` to what a search
 * comes back with.
 *
 * The preference is applied as a filter on the OUTGOING search rather than as a
 * post-filter on the results, which is what keeps the tab counts and the
 * pagination honest -- and also what makes a break here invisible from the
 * settings page alone: the switch would still look flipped while every search
 * kept returning the category. Nothing covered the far end of that until now.
 *
 * The far end is reached by navigating WITHIN the app rather than by loading the
 * search page fresh. SSR caches a session's preferences for 30s, so a full load
 * right after the switch is flipped can still be rendering the old answer -- and
 * "flip it, then search" without a reload is what a reader actually does anyway.
 *
 * Which category gets hidden is decided from the tabs the query actually
 * returns, never hard-coded: a corpus with no YouTube clips in it would
 * otherwise fail this test for having nothing to hide.
 */

async function hiddenCategories(page: Page): Promise<string[]> {
  const response = await page.request.get('/v1/user/preferences');
  if (!response.ok()) return [];
  const data = (await response.json()) as { hiddenCategories?: string[] };
  return data.hiddenCategories ?? [];
}

const resetHiddenCategories = (page: Page) =>
  page.request.patch('/v1/user/preferences', { data: { hiddenCategories: [] } });

/**
 * The switch a reader presses, which is the LABEL rather than the checkbox.
 *
 * The checkbox itself is `sr-only` and sits under the styled track, so clicking
 * it directly is intercepted -- and `locator.click()` has no default timeout, so
 * that does not fail, it hangs until the whole test times out. The label is both
 * the honest target and the one that works.
 */
function categorySwitch(page: Page, slug: CategorySlug) {
  return page.locator(`label:has([data-testid="hidden-category-toggle-${slug}"])`);
}

/** The category tabs this query came back with, in the order they are shown. */
async function visibleCategorySlugs(page: Page): Promise<CategorySlug[]> {
  await expect(page.getByTestId('search-category-tabs')).toBeVisible({ timeout: 15_000 });
  const slugs: CategorySlug[] = [];
  for (const slug of Object.keys(CATEGORY_BY_SLUG) as CategorySlug[]) {
    if (await page.getByTestId(`search-category-tab-${slug}`).isVisible().catch(() => false)) {
      slugs.push(slug);
    }
  }
  return slugs;
}

test.describe('Hidden categories', () => {
  test.describe.configure({ mode: 'serial' });

  test('hiding a category takes it out of search', async ({ page }) => {
    await loginAsE2EUser(page);
    await resetHiddenCategories(page);

    await page.goto(`/search/${encodeURIComponent(QUERY)}`);
    const slugs = await visibleCategorySlugs(page);
    test.skip(slugs.length < 2, `"${QUERY}" only returns ${slugs.join(', ') || 'nothing'}; nothing to hide`);

    // The last tab rather than the first: hiding the one the reader is least
    // likely to be reading leaves the results non-empty afterwards, which is the
    // second half of the assertion.
    const hiddenSlug = slugs[slugs.length - 1]!;
    const survivingSlug = slugs[0]!;

    await page.goto('/user/media');
    const toggle = page.getByTestId(`hidden-category-toggle-${hiddenSlug}`);
    await expect(toggle).toBeAttached({ timeout: 10_000 });
    await expect(toggle).toBeChecked();

    try {
      await categorySwitch(page, hiddenSlug).click();
      await expect
        .poll(() => hiddenCategories(page), { timeout: 10_000 })
        .toContain(CATEGORY_BY_SLUG[hiddenSlug]);

      // Back to a search the way a reader gets there from here: through the app,
      // with the preference they just set already in hand.
      // The header logo, which is the only in-app route out of a settings tab
      // that every viewport shows.
      await page.locator('header').getByRole('link', { name: /Nadeshiko/i }).first().click();
      const searchInput = page.getByTestId('search-input');
      await expect(searchInput).toBeVisible({ timeout: 15_000 });
      await searchInput.fill(QUERY);
      await searchInput.press('Enter');
      await page.waitForURL(/\/search\//, { timeout: 15_000 });

      await expect(page.getByTestId('search-category-tabs')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`search-category-tab-${hiddenSlug}`)).toHaveCount(0);
      // The category is gone, not the search: the other tabs still answer.
      await expect(page.getByTestId(`search-category-tab-${survivingSlug}`)).toBeVisible();
      await expect(page.getByTestId('segment-card').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await resetHiddenCategories(page);
    }
  });

  test('the last visible category cannot be hidden', async ({ page }) => {
    // The rule exists because an empty category list reads as "no filter" rather
    // than "nothing", so hiding the last one would hand back the whole corpus --
    // the exact opposite of what the reader asked for.
    await loginAsE2EUser(page);
    await resetHiddenCategories(page);
    await page.goto('/user/media');

    // State is read from the checkbox (`toBeChecked`/`toBeDisabled` work on a
    // visually hidden input); presses go to the label.
    const anime = page.getByTestId('hidden-category-toggle-anime');
    const liveaction = page.getByTestId('hidden-category-toggle-liveaction');
    await expect(anime).toBeAttached({ timeout: 10_000 });

    try {
      await categorySwitch(page, 'liveaction').click();
      await expect.poll(() => hiddenCategories(page), { timeout: 10_000 }).toContain('JDRAMA');
      await categorySwitch(page, 'youtube').click();
      await expect.poll(() => hiddenCategories(page), { timeout: 10_000 }).toContain('YOUTUBE');

      await expect(anime).toBeDisabled();
      // And the hidden two can still be brought back, or a reader would be stuck
      // with whatever they hid last.
      await expect(liveaction).toBeEnabled();
    } finally {
      await resetHiddenCategories(page);
    }
  });
});
