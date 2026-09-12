import { e2eAccountForWorker, loginAsE2EUser, test, expect } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';
import { SearchPage } from '../pages/SearchPage';

test.describe('Reporting and moderation', () => {
  test('submits a sentence report and exposes the persisted report to an admin', async ({ authenticatedPage, browser }) => {
    const search = new SearchPage(authenticatedPage);
    await search.goto('学校');
    await search.expectResultsVisible();

    const card = search.segmentCards.first();
    await card.getByTestId('more-dropdown').getByTestId('dropdown-toggle').click();
    await authenticatedPage.getByTestId('dropdown-menu').getByRole('button', { name: 'Report sentence' }).click();

    const modal = authenticatedPage.getByTestId('report-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Other', exact: true }).click();
    const description = `E2E moderation report ${process.env.E2E_EXPECTED_SHA ?? Date.now()}`;
    await modal.getByRole('textbox', { name: 'Description' }).fill(description);

    const createdResponse = authenticatedPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/v1/user/reports' && response.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: 'Submit', exact: true }).click();
    const created = await createdResponse;
    expect(created.status(), await created.text()).toBe(201);
    const report = (await created.json()) as { id: number };
    expect(report.id).toBeGreaterThan(0);
    await expect(modal).toBeHidden();

    const admin = await browser.newContext({ baseURL: getE2EBaseUrl(), extraHTTPHeaders: e2eBypassHeaders() });
    const adminPage = await admin.newPage();
    try {
      await loginAsE2EUser(adminPage, e2eAccountForWorker(9));
      const listed = await adminPage.request.get('/v1/admin/reports?take=100');
      expect(listed, await listed.text()).toBeOK();
      expect(JSON.stringify(await listed.json())).toContain(description);

      const updated = await adminPage.request.patch(`/v1/admin/reports/${report.id}`, {
        data: { status: 'PROCESSING', adminNotes: 'Verified by staging E2E' },
      });
      expect(updated, await updated.text()).toBeOK();

      await adminPage.goto('/user/admin/reports');
      await expect(adminPage.getByTestId('reports-title')).toBeVisible({ timeout: 15_000 });
      await expect(adminPage.getByTestId('report-row').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      if (report.id) await adminPage.request.delete(`/v1/admin/reports/${report.id}`).catch(() => {});
      await admin.close();
    }
  });
});
