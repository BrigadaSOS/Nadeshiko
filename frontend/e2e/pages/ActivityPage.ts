import { type Locator, type Page, expect } from '@playwright/test';

export class ActivityPage {
  readonly page: Page;
  readonly overviewHeading: Locator;
  readonly searchesCount: Locator;
  readonly playsCount: Locator;
  readonly exportsCount: Locator;
  readonly sharesCount: Locator;
  readonly historyHeading: Locator;
  readonly heatmapHeading: Locator;
  readonly noActivityMessage: Locator;
  readonly activityTable: Locator;
  readonly allTimeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.overviewHeading = page.getByRole('heading', { name: 'Activity Overview' });
    this.searchesCount = page.locator('text=Sentences Searched').locator('..').locator('p.text-2xl');
    this.playsCount = page.locator('text=Audios Played').locator('..').locator('p.text-2xl');
    this.exportsCount = page.locator('text=Anki Exports').locator('..').locator('p.text-2xl');
    this.sharesCount = page.locator('text=Links Shared').locator('..').locator('p.text-2xl');
    this.historyHeading = page.getByRole('heading', { name: 'Activity History' });
    this.heatmapHeading = page.getByRole('heading', { name: 'Activity Heatmap' });
    this.noActivityMessage = page.getByText('No activity recorded yet.');
    this.activityTable = page.locator('table');
    this.allTimeButton = page.getByRole('button', { name: 'All Time' });
  }

  async goto() {
    await this.page.goto('/user/activity');
  }

  async expectLoaded() {
    await expect(this.overviewHeading).toBeVisible({ timeout: 10_000 });
    await expect(this.historyHeading).toBeVisible({ timeout: 10_000 });
  }

  async refreshStats() {
    // Toggle range to force a client-side refetch of stats,
    // since useAsyncData initial data comes from SSR (without auth cookie).
    const sevenDayButton = this.page.getByRole('button', { name: '7d' });
    await this.allTimeButton.click();
    await this.page.waitForLoadState('networkidle');
    await sevenDayButton.click();
    await this.page.waitForLoadState('networkidle');
    await this.allTimeButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getSearchesCount(): Promise<number> {
    const text = await this.searchesCount.textContent();
    return Number(text?.trim() ?? '0');
  }

  get activityRows() {
    return this.activityTable.locator('tbody tr');
  }

  activityRowByText(text: string) {
    return this.activityRows.filter({ hasText: text });
  }
}
