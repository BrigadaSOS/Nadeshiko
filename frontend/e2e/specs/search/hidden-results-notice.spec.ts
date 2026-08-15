import { test, expect } from '../../auth';

/**
 * The line above the results that accounts for what the reader's own hidden
 * titles are keeping out of them.
 *
 * Worth its own spec because the notice is the only thing standing between
 * hiding a show and the corpus quietly looking smaller: hidden-media.spec.ts
 * proves the hiding works, and nothing proved the reader is ever told. The
 * breakdown is deliberately behind a click -- hiding is mostly a spoiler tool,
 * so a notice that named the title unprompted would undo the reason it was
 * hidden -- and that is asserted here rather than left as a comment on the
 * component.
 */
const SEARCH = '/search/'.concat(encodeURIComponent('私'));

const resultMediaIds = async (page: any): Promise<string[]> => {
  const response = await page.request.post('/v1/search', {
    data: { query: { search: '私' }, take: 50, include: ['media'] },
  });
  const { segments } = await response.json();
  return segments.map((segment: { mediaPublicId: string }) => segment.mediaPublicId);
};

test.describe('Hidden results notice', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ authenticatedPage }) => {
    const response = await authenticatedPage.request.get('/v1/user/excluded-media');
    const { excludedMedia } = await response.json();
    for (const media of excludedMedia) {
      await authenticatedPage.request.delete(`/v1/user/excluded-media/${media.publicId}`);
    }
  });

  test('accounts for the hits a hidden title keeps out, names it on request, and can lift it', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Hide whichever title the search actually returns, rather than a title
    // picked in advance: the local corpus is not fixed, and hiding a show with
    // no hits for this query would produce a notice with nothing to report.
    const before = await resultMediaIds(page);
    const target = before[0];
    expect(target, 'the search must return something to hide').toBeTruthy();

    await page.request.post('/v1/user/excluded-media', { data: { mediaPublicId: target } });

    await page.goto(SEARCH);

    const notice = page.getByTestId('hidden-results-notice');
    await expect(notice).toBeVisible({ timeout: 20_000 });

    // The title is not named until asked for.
    await expect(page.getByTestId('hidden-results-breakdown')).toHaveCount(0);

    await page.getByTestId('hidden-results-breakdown-trigger').click();
    const breakdown = page.getByTestId('hidden-results-breakdown');
    await expect(breakdown).toBeVisible({ timeout: 15_000 });
    await expect(breakdown.locator('li').first()).toBeVisible();

    // Showing them for this search swaps the line for the revealed one, which
    // has nothing left to explain and so carries no breakdown link at all.
    // Asserted on the link rather than on the wording, which is translated, and
    // on the results count, which a full page of 30 hides.
    await page.getByTestId('hidden-results-toggle').click();
    await expect(page.getByTestId('hidden-results-breakdown-trigger')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-testid="segment-card"]').first()).toBeVisible({ timeout: 15_000 });

    // ...and restoring puts them back out.
    await page.getByTestId('hidden-results-toggle').click();
    await expect(page.getByTestId('hidden-results-breakdown-trigger')).toBeVisible({ timeout: 15_000 });

    await page.request.delete(`/v1/user/excluded-media/${target}`);
  });

  test('stays away when the reader has hidden nothing', async ({ authenticatedPage }) => {
    // The counterpart that keeps the test above honest: a notice that rendered
    // unconditionally would pass every assertion in it.
    await authenticatedPage.goto(SEARCH);

    await expect(authenticatedPage.locator('[data-testid="segment-card"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(authenticatedPage.getByTestId('hidden-results-notice')).toHaveCount(0);
  });
});
