import { test, expect } from '../auth';
import { ReportsPage } from '../pages/ReportsPage';

test.describe('Admin Reports', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.goto();

    // Skip if user is not admin (redirected away from admin page)
    const url = authenticatedPage.url();
    test.skip(!url.includes('/user/admin/reports'), 'e2e user is not admin');
  });

  test('displays reports page with title and filters', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    await expect(reports.sourceAllButton).toBeVisible();
    await expect(reports.sourceUserButton).toBeVisible();
    await expect(reports.sourceAutoButton).toBeVisible();
    await expect(reports.orphanedFilter).toBeVisible();
    await expect(reports.dismissAllButton).toBeVisible();
    await expect(reports.deleteAllButton).toBeVisible();
  });

  test('source filter switches between All, User, and Auto', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.sourceUserButton.click(),
    ]);

    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.sourceAutoButton.click(),
    ]);

    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.sourceAllButton.click(),
    ]);
  });

  test('status filter toggles work', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    // Toggle OPEN off
    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.clickStatusFilter('OPEN'),
    ]);

    // Toggle OPEN back on
    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.clickStatusFilter('OPEN'),
    ]);
  });

  test('orphaned filter toggles', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.orphanedFilter.click(),
    ]);

    // Should show orphaned reports or empty state
    const hasRows = (await reports.getRowCount()) > 0;
    if (!hasRows) {
      await expect(reports.emptyState).toBeVisible();
    }

    // Toggle off
    await Promise.all([
      authenticatedPage.waitForResponse((r) => r.url().includes('/v1/admin/reports') && r.status() === 200),
      reports.orphanedFilter.click(),
    ]);
  });

  test('dismiss all matching shows confirmation modal', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    await reports.dismissAllButton.click();
    await expect(authenticatedPage.getByText('Dismiss all matching reports?')).toBeVisible();

    // Cancel
    await authenticatedPage.getByRole('button', { name: 'Cancel' }).click();
    await expect(authenticatedPage.getByText('Dismiss all matching reports?')).not.toBeVisible();
  });

  test('delete all matching shows confirmation modal', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    await reports.deleteAllButton.click();
    await expect(authenticatedPage.getByText('permanently delete')).toBeVisible();

    // Cancel
    await authenticatedPage.getByRole('button', { name: 'Cancel' }).click();
    await expect(authenticatedPage.getByText('permanently delete')).not.toBeVisible();
  });

  test('single report actions are visible', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    const rowCount = await reports.getRowCount();
    test.skip(rowCount === 0, 'No reports available to test actions');

    const firstRow = reports.reportRows.first();
    // Should have at least some action buttons
    await expect(firstRow.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('delete button shows confirmation modal', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    const rowCount = await reports.getRowCount();
    test.skip(rowCount === 0, 'No reports available to test delete');

    const firstRow = reports.reportRows.first();
    await reports.clickActionOnRow(firstRow, 'Delete');

    await expect(authenticatedPage.getByText('Delete this report group?')).toBeVisible();

    // Cancel
    await authenticatedPage.getByRole('button', { name: 'Cancel' }).click();
    await expect(authenticatedPage.getByText('Delete this report group?')).not.toBeVisible();
  });

  test('select all checkbox toggles selection', async ({ authenticatedPage }) => {
    const reports = new ReportsPage(authenticatedPage);
    await reports.expectLoaded();

    const rowCount = await reports.getRowCount();
    test.skip(rowCount === 0, 'No reports available to test selection');

    await reports.selectAllCheckbox.check();
    await expect(authenticatedPage.getByText(/\d+ group\(s\) selected/)).toBeVisible();

    // Batch action bar should appear
    await expect(authenticatedPage.getByRole('button', { name: 'Clear' })).toBeVisible();

    // Clear selection
    await authenticatedPage.getByRole('button', { name: 'Clear' }).click();
    await expect(authenticatedPage.getByText(/\d+ group\(s\) selected/)).not.toBeVisible();
  });
});
