import type { Locator, Page } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../../auth';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';

/**
 * What the media filter does for a reader with an account: the star beside each
 * title, and the order the star and the study tally impose on the list.
 *
 * The order is the whole feature -- `compareMediaRows` puts starred titles
 * first, then the ones the reader studies, then the rest alphabetically -- and
 * only the starred tier had a test above the unit level. The studied tier had
 * none, so a ranking that never reached the list, or reached it and then
 * reshuffled after hydration, looked exactly like a working one.
 *
 * Titles are identified by the label the list itself renders, never by a name
 * from the API: which of the three names a row shows is the reader's own
 * preference, and a test that hard-codes one is testing that preference.
 */

/**
 * Title rows only: the star is what a title has and an episode spacer does not.
 *
 * `:visible` because the panel exists twice -- the sticky sidebar and the
 * small-screen drawer -- and only one of them is on screen at a given width. A
 * text assertion reads a hidden copy perfectly happily, so without this the
 * ordering tests would pass while asserting against markup no reader can see.
 */
function titleRows(page: Page) {
  return page
    .locator('[data-testid="media-filter-row"]:visible')
    .filter({ has: page.getByTestId('media-filter-favorite') });
}

/** The title on a row, without the hit count that sits beside it. */
async function rowLabel(row: Locator): Promise<string> {
  return ((await row.locator('button span').first().textContent()) ?? '').trim();
}

/**
 * publicId for a title, matched on whichever name the row is showing.
 *
 * Pages through `/v1/media` rather than reading one response. That endpoint
 * defaults to 20 per page and caps at 40, so a single request only ever saw the
 * front of the catalogue -- which worked until the corpus outgrew it, and then
 * failed as `no media in /v1/media is named "..."` for a title plainly on
 * screen. The label comes from the filter panel, so it is by definition a title
 * the API knows; not finding it means we stopped looking too early.
 */
async function publicIdForLabel(page: Page, label: string): Promise<string> {
  type MediaRow = { publicId: string; nameEn?: string; nameJa?: string; nameRomaji?: string };
  const matches = (item: MediaRow) => [item.nameEn, item.nameJa, item.nameRomaji].some((name) => name === label);

  let cursor: string | null = null;
  // Bounded so a pagination bug cannot turn this into an infinite loop; 40 pages
  // of 40 is far more catalogue than this suite will ever face.
  for (let page_ = 0; page_ < 40; page_++) {
    const query = new URLSearchParams({ take: '40', ...(cursor ? { cursor } : {}) });
    const response = await page.request.get(`/v1/media?${query}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = (await response.json()) as {
      media: MediaRow[];
      pagination?: { hasMore?: boolean; cursor?: string | null };
    };

    const match = body.media.find(matches);
    if (match) return match.publicId;

    if (!body.pagination?.hasMore || !body.pagination.cursor) break;
    cursor = body.pagination.cursor;
  }

  throw new Error(`no media in /v1/media is named "${label}"`);
}

async function familiarMediaIds(page: Page): Promise<string[]> {
  const response = await page.request.get('/v1/user/familiar-media');
  // Asserted rather than swallowed: a 429 from the API limiter returns no
  // entries, which is indistinguishable from "the tally did not record" unless
  // the status is checked. Silently reading it as an empty ranking is how a
  // rate-limited run blames the feature.
  expect(response, await response.text()).toBeOK();
  const data = (await response.json()) as { familiarMedia?: Array<{ media?: { publicId?: string } }> };
  return (data.familiarMedia ?? []).map((entry) => entry.media?.publicId ?? '');
}

async function clearAccountState(page: Page): Promise<void> {
  const response = await page.request.get('/v1/user/favorite-media');
  if (response.ok()) {
    const { favoriteMedia } = (await response.json()) as { favoriteMedia?: Array<{ publicId: string }> };
    for (const media of favoriteMedia ?? []) {
      await page.request.delete(`/v1/user/favorite-media/${media.publicId}`);
    }
  }
  await page.request.delete('/v1/user/familiar-media');
}

test.describe('Media filter (signed in)', () => {
  test.describe.configure({ mode: 'serial' });
  // The title sidebar is `2xl:` and up; the project's default 1280 viewport
  // renders it hidden.
  test.use({ viewport: { width: 1728, height: 1000 } });

  test('a title the reader studies sorts above the alphabetical order', async ({ page }) => {
    await loginAsE2EUser(page);
    await clearAccountState(page);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const rowCount = await titleRows(page).count();
    test.skip(rowCount < 2, `"${QUERY}" matched fewer than two titles, so there is no order to change`);

    // The row alphabetical order puts LAST, so "it is first now" cannot be true
    // by accident.
    const studiedLabel = await rowLabel(titleRows(page).nth(rowCount - 1));
    const firstBefore = await rowLabel(titleRows(page).first());
    expect(studiedLabel).not.toBe(firstBefore);

    // One Anki export clears MIN_SCORE on its own: the tally weighs deliberate
    // mining heaviest, which is the whole reason it is not a play count.
    const studiedId = await publicIdForLabel(page, studiedLabel);
    const recorded = await page.request.post('/v1/user/activity', {
      data: { activityType: 'ANKI_EXPORT', mediaPublicId: studiedId },
    });
    expect(recorded, await recorded.text()).toBeOK();
    await expect.poll(() => familiarMediaIds(page), { timeout: 15_000 }).toContain(studiedId);

    await search.goto(QUERY);
    await search.expectResultsVisible();
    expect(await rowLabel(titleRows(page).first())).toBe(studiedLabel);

    // And it holds through hydration rather than snapping into place after it:
    // the ranking rides the SSR payload precisely so the list cannot reshuffle
    // under a cursor already reaching for a row.
    await search.expectHydrated();
    expect(await rowLabel(titleRows(page).first())).toBe(studiedLabel);

    await clearAccountState(page);
  });

  test('a starred title outranks a studied one', async ({ page }) => {
    await loginAsE2EUser(page);
    await clearAccountState(page);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const rowCount = await titleRows(page).count();
    test.skip(rowCount < 2, `"${QUERY}" matched fewer than two titles`);

    const studiedLabel = await rowLabel(titleRows(page).nth(rowCount - 1));
    const starredLabel = await rowLabel(titleRows(page).nth(rowCount - 2));

    const studyRecorded = await page.request.post('/v1/user/activity', {
      data: { activityType: 'ANKI_EXPORT', mediaPublicId: await publicIdForLabel(page, studiedLabel) },
    });
    expect(studyRecorded, await studyRecorded.text()).toBeOK();
    const starred = await page.request.post('/v1/user/favorite-media', {
      data: { mediaPublicId: await publicIdForLabel(page, starredLabel) },
    });
    expect(starred, await starred.text()).toBeOK();

    await search.goto(QUERY);
    await search.expectResultsVisible();

    // Tiers, not alphabet: the star wins even though the studied title sorts
    // after it by name and would otherwise be the one on top.
    expect(await rowLabel(titleRows(page).first())).toBe(starredLabel);
    expect(await rowLabel(titleRows(page).nth(1))).toBe(studiedLabel);

    await clearAccountState(page);
  });

  test('starring a row does not also filter by it', async ({ page }) => {
    // Narrow on purpose: `favorite-media.spec.ts` already covers that the star
    // writes the preference and that a fresh render agrees. What is only
    // testable here is the other half -- the star and the filter are siblings
    // inside one row, and only `@click.stop` keeps pressing one from doing the
    // other's job. Without it, starring a title also drops the reader into it,
    // silently, because both are plausible outcomes of clicking a row.
    await loginAsE2EUser(page);
    await clearAccountState(page);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const row = titleRows(page).first();
    const star = row.getByTestId('media-filter-favorite');
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    const urlBefore = page.url();
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    expect(page.url()).toBe(urlBefore);
    expect(new URL(page.url()).searchParams.get('media')).toBeNull();

    // Unstarring goes back the same way, from the same control, and is just as
    // much not a filter click.
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    expect(page.url()).toBe(urlBefore);

    await clearAccountState(page);
  });
});
