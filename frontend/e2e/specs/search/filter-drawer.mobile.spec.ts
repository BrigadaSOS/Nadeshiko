import type { Page } from '@playwright/test';

import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';

/**
 * The small-screen half of the media filter: the same panel the `2xl:` sidebar
 * shows, but in a drawer that covers the results it filters.
 *
 * That covering is the whole subject here. Every assertion below checks the
 * drawer's own state as well as the filter's, because the regression these
 * tests exist for changed neither the URL nor the results: picking a title set
 * `?media=` correctly and the list underneath re-rendered correctly. The
 * drawer intentionally stays open now, so the assertions make sure the panel
 * itself continues into the selected title's episode level.
 *
 * The desktop specs cannot catch it -- there is no drawer above `2xl` -- so
 * this file runs under the `mobile` project, which is what the `.mobile.spec.ts`
 * suffix selects.
 */

const drawer = (page: Page) => page.getByTestId('filter-drawer');
const drawerToggle = (page: Page) => page.getByTestId('filter-drawer-toggle');

/**
 * Opens the drawer, or leaves it open if it already is.
 *
 * The guard is the whole point. Picking a title deliberately KEEPS the drawer
 * open on its episode level -- there is a test for exactly that above -- so the
 * callers that pick a title and then want the drawer again are already looking
 * at it. Clicking the toggle in that state does not close-and-reopen: the open
 * drawer's own scroll container sits over the button and swallows the click, so
 * Playwright retried for the full minute and reported "subtree intercepts
 * pointer events".
 */
async function openDrawer(page: Page) {
  if (await drawer(page).isVisible().catch(() => false)) return;
  await drawerToggle(page).click();
  await expect(drawer(page)).toBeVisible({ timeout: 10_000 });
}

/**
 * The title rows, identified by the `data-row-id` the panel stamps on each one.
 *
 * That attribute carries the media's publicId, so matching on it rather than
 * the word "All" (which used to be a row) cannot throw away a title that
 * happens to contain it.
 */
function titleRows(page: Page) {
  return drawer(page).locator('[data-testid="media-filter-row"][data-row-id]');
}

/** The episode level is only episodes; every row there is one. */
function episodeRows(page: Page) {
  return drawer(page).getByTestId('media-filter-row');
}

/** The label on a row, without the hit count beside it. */
async function rowLabel(row: ReturnType<typeof titleRows>): Promise<string> {
  return ((await row.locator('button span').first().textContent()) ?? '').trim();
}

test.describe('Media filter drawer (mobile)', () => {
  test('picking a title keeps the drawer open on its episode level', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await openDrawer(page);
    const title = await rowLabel(titleRows(page).first());
    await titleRows(page).first().click();

    await expect(drawer(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });

    // The filter did land, and the word survived it: a drawer that closes onto
    // an unfiltered list, or onto a browse of the whole title, is not a pass.
    await search.expectResultsVisible();
    expect(search.searchedWord()).toBe(QUERY);
    await expect(search.segmentCards.first().getByTestId('segment-media-name')).toContainText(title);
  });

  test('picking an episode closes the drawer onto the filtered results', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    // Drill in first: the episode level is only reachable through a title, and
    // only a title with episodes behind it has one -- a movie stays on the list.
    await openDrawer(page);
    await titleRows(page).first().click();
    await expect(drawer(page)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    await search.expectResultsVisible();

    // The URL moves the existing open panel into the episode level; the level
    // is read from the URL, never stored.
    const back = drawer(page).getByTestId('media-filter-back');
    if (!(await back.isVisible().catch(() => false))) {
      test.skip(true, `the first title matching ${QUERY} has no episode level`);
    }

    await episodeRows(page).first().click();

    await expect(drawer(page)).toBeHidden({ timeout: 10_000 });
    await expect(page).toHaveURL(/episode=/, { timeout: 10_000 });
    await search.expectResultsVisible();
    expect(search.searchedWord()).toBe(QUERY);
  });

  test('backing out of the episode level keeps the drawer open', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await openDrawer(page);
    await titleRows(page).first().click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    await search.expectResultsVisible();

    await openDrawer(page);
    const back = drawer(page).getByTestId('media-filter-back');
    if (!(await back.isVisible().catch(() => false))) {
      test.skip(true, `the first title matching ${QUERY} has no episode level`);
    }

    // The exception to the rule above, and the reason the panel emits on picks
    // rather than on every URL change: backing out is the reader working the
    // panel, so it drops the filter WITHOUT dismissing the thing they are
    // working in. Closing here would make the title list unreachable in one go.
    await back.click();
    await expect(drawer(page)).toBeVisible();
    await expect(page).not.toHaveURL(/media=/, { timeout: 10_000 });
    await expect(titleRows(page).first()).toBeVisible();
  });

  test('backing out of a browsed title keeps the drawer open', async ({ page }) => {
    const search = new SearchPage(page);
    // Bare `/search`, not a word: picking a title leaves this page for
    // `/media/<slug>`, and back comes back by remounting `/search`. A
    // drawer held in a local ref died on that remount, so going back to the
    // all list looked like it had closed the filter.
    await search.goto();
    await search.expectResultsVisible();

    await openDrawer(page);
    await titleRows(page).first().click();
    await expect(drawer(page)).toBeHidden({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/media\//, { timeout: 10_000 });
    await search.expectResultsVisible();
    await expect(drawerToggle(page)).toBeVisible({ timeout: 10_000 });

    await openDrawer(page);
    const back = drawer(page).getByTestId('media-filter-back');
    if (await back.isVisible().catch(() => false)) {
      await back.click();
    } else {
      // A movie never drills in: a second click on the title already in scope
      // drops it, the same way a second click on an episode does.
      await titleRows(page).first().click();
    }

    await expect(drawer(page)).toBeVisible();
    await expect(page).toHaveURL(/\/search\/?(?:\?|$)/, { timeout: 10_000 });
    await expect(titleRows(page).first()).toBeVisible();
  });

  test('the single-sentence page offers no filter drawer', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const sentenceId = await search.segmentCards.first().getAttribute('id');
    expect(sentenceId).toBeTruthy();

    await page.goto(`/sentence/${sentenceId}`);
    await expect(search.segmentCards.first()).toBeVisible({ timeout: 15_000 });
    await search.expectHydrated();

    // One card, and nothing the filters could narrow it to. The `2xl:` sidebar
    // has always been hidden here; the drawer used to offer itself anyway, and
    // picking a title from it pushed a `?media=` this page ignores.
    await expect(drawerToggle(page)).toBeHidden();
    await expect(drawer(page)).toBeHidden();
  });

  test('picking a sort closes the drawer and the button names the sort', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await openDrawer(page);
    await drawer(page).getByTestId('dropdown-toggle').click();
    await drawer(page).getByTestId('dropdown-menu').getByRole('button', { name: 'Largest' }).click();

    await expect(drawer(page)).toBeHidden({ timeout: 10_000 });
    await expect(page).toHaveURL(/sort=desc/, { timeout: 10_000 });
    await search.expectResultsVisible();

    // The label is read from `?sort=` on every render rather than latched when
    // the button was clicked. It used to be a snapshot taken at setup, so the
    // copy that remounted mid-navigation came back reading "Sort sentences"
    // with no sort named -- while sorted results sat underneath it.
    await openDrawer(page);
    await expect(drawer(page).getByTestId('sort-active-label')).toHaveText('(Largest)');
  });

  test('a search that matched no titles offers no filter drawer', async ({ page }) => {
    const search = new SearchPage(page);
    // Kana that no line is going to contain in that order, so the search is
    // well-formed and simply matches nothing.
    await search.goto('かきくけこさしすせそ');
    await search.expectNoResults();

    // The button used to be offered regardless, and opened a drawer holding a
    // title and a close button: the panel inside it is gated on there being
    // results, and its stand-in skeleton was `hidden lg:block` inside a drawer
    // that only opens below `2xl`, so a phone got a blank panel.
    await expect(drawerToggle(page)).toBeHidden();
    await expect(drawer(page)).toBeHidden();
  });

  test('picking Random again reshuffles instead of returning the same order', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const order = () => search.segmentCards.getByTestId('segment-japanese-text').allInnerTexts();
    const seed = () => new URL(page.url()).searchParams.get('seed');

    const pickRandom = async () => {
      await openDrawer(page);
      await drawer(page).getByTestId('dropdown-toggle').click();
      await drawer(page).getByTestId('dropdown-menu').getByRole('button', { name: 'Random' }).click();
      await expect(drawer(page)).toBeHidden({ timeout: 10_000 });
      await expect(page).toHaveURL(/sort=random&seed=\d+/, { timeout: 10_000 });
      await search.expectResultsVisible();
    };

    await pickRandom();
    const firstSeed = seed();
    const firstOrder = await order();

    // Repeated a few times before giving up: a fresh seed is guaranteed, a
    // different order is only overwhelmingly likely, and one flaky assertion in
    // this suite is worse than three clicks. Before the seed rode in the URL the
    // order was identical every time -- the backend derives its own seed from
    // the calendar day -- so this fails on the first pass if that comes back.
    let reshuffled = false;
    for (let attempt = 0; attempt < 3 && !reshuffled; attempt++) {
      const previousSeed = seed();
      await pickRandom();
      expect(seed()).not.toBe(previousSeed);
      reshuffled = JSON.stringify(await order()) !== JSON.stringify(firstOrder);
    }
    expect(reshuffled, 'picking Random again returned the same order every time').toBe(true);
    expect(seed()).not.toBe(firstSeed);
  });

  test('a seeded random URL is reproducible, and other sorts drop the seed', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await openDrawer(page);
    await drawer(page).getByTestId('dropdown-toggle').click();
    await drawer(page).getByTestId('dropdown-menu').getByRole('button', { name: 'Random' }).click();
    await expect(page).toHaveURL(/seed=\d+/, { timeout: 10_000 });
    await search.expectResultsVisible();

    // The point of putting the seed in the URL rather than in memory: the link
    // names one shuffle, so it survives a reload instead of re-rolling.
    const seededUrl = page.url();
    const shuffled = await search.segmentCards.getByTestId('segment-japanese-text').allInnerTexts();
    await page.goto(seededUrl);
    await search.expectResultsVisible();
    expect(await search.segmentCards.getByTestId('segment-japanese-text').allInnerTexts()).toEqual(shuffled);

    // And the seed belongs to random alone: left behind on another sort it is a
    // parameter nothing reads, which comes back to life if random is picked again.
    await openDrawer(page);
    await drawer(page).getByTestId('dropdown-toggle').click();
    await drawer(page).getByTestId('dropdown-menu').getByRole('button', { name: 'Shortest' }).click();
    await expect(page).toHaveURL(/sort=asc/, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/seed=/, { timeout: 10_000 });
  });

  test('the sort label survives a reload and a back button', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await openDrawer(page);
    await drawer(page).getByTestId('dropdown-toggle').click();
    await drawer(page).getByTestId('dropdown-menu').getByRole('button', { name: 'Random' }).click();
    await expect(page).toHaveURL(/sort=random/, { timeout: 10_000 });
    await search.expectResultsVisible();

    await page.reload();
    await search.expectResultsVisible();
    await openDrawer(page);
    await expect(drawer(page).getByTestId('sort-active-label')).toHaveText('(Random)');

    // And back to the unsorted search: the label has to go away as well as
    // appear, which a ref that only ever moves forward on a click does not do.
    // Asserted without reopening, because the drawer stays open across a back
    // navigation -- so this is the label updating under the reader's eyes,
    // which is the case a remount would have papered over.
    await page.goBack();
    await search.expectResultsVisible();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByTestId('sort-active-label')).toBeHidden();
  });
});
