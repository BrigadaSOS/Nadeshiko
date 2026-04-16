import { type Locator, type Page, expect } from '@playwright/test';

export class ReportsPage {
  readonly page: Page;
  readonly title: Locator;
  readonly reportRows: Locator;
  readonly orphanedFilter: Locator;
  readonly sourceAllButton: Locator;
  readonly sourceUserButton: Locator;
  readonly sourceAutoButton: Locator;
  readonly dismissAllButton: Locator;
  readonly deleteAllButton: Locator;
  readonly loadMoreButton: Locator;
  readonly emptyState: Locator;
  readonly selectAllCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByTestId('reports-title');
    this.reportRows = page.getByTestId('report-row');
    this.orphanedFilter = page.getByTestId('orphaned-filter');
    this.sourceAllButton = page.getByRole('button', { name: 'All', exact: true });
    this.sourceUserButton = page.getByRole('button', { name: 'User Reports' });
    this.sourceAutoButton = page.getByRole('button', { name: 'Auto Checks' });
    this.dismissAllButton = page.getByRole('button', { name: 'Dismiss All Matching' });
    this.deleteAllButton = page.getByRole('button', { name: 'Delete All Matching' });
    this.loadMoreButton = page.getByRole('button', { name: /Load more/i });
    this.emptyState = page.getByText('No reports found');
    this.selectAllCheckbox = page.locator('thead input[type="checkbox"]');
  }

  async goto() {
    await this.page.goto('/user/admin/reports');
  }

  async expectLoaded() {
    await expect(this.title).toBeVisible({ timeout: 10_000 });
  }

  reportRowByReason(reason: string) {
    return this.reportRows.filter({ hasText: reason });
  }

  async getRowCount() {
    return this.reportRows.count();
  }

  async clickStatusFilter(status: string) {
    await this.page.getByRole('button', { name: status, exact: true }).click();
  }

  async clickActionOnRow(row: Locator, action: string) {
    await row.getByRole('button', { name: action, exact: true }).click();
  }

  async confirmDelete() {
    const modal = this.page.locator('.fixed.inset-0').filter({ hasText: 'Delete' });
    await modal.getByRole('button', { name: 'Delete', exact: true }).click();
  }

  async confirmDismissAll() {
    const modal = this.page.locator('.fixed.inset-0').filter({ hasText: 'Dismiss all matching' });
    await modal.getByRole('button', { name: 'Dismiss All' }).click();
  }

  async confirmDeleteAll() {
    const modal = this.page.locator('.fixed.inset-0').filter({ hasText: 'permanently delete' });
    await modal.getByRole('button', { name: 'Delete All' }).click();
  }
}
