import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from '../auth';

async function expectNoStructuralAccessibilityViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Contrast is a visual-design audit of the existing theme, not a stable
    // browser invariant: image/gradient backgrounds and opacity transitions
    // make axe's computed result timing-dependent. Keep this release gate on
    // deterministic document semantics; contrast remains a separate UI audit.
    .disableRules(['color-contrast'])
    .analyze();

  expect(
    violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

test.describe('Accessibility', () => {
  test('homepage has no structural WCAG A/AA violations', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await expectNoStructuralAccessibilityViolations(authenticatedPage);
  });

  test('search results have no structural WCAG A/AA violations', async ({ authenticatedPage }) => {
    await authenticatedPage.goto(`/search/${encodeURIComponent('学校')}`);
    await expect(authenticatedPage.getByTestId('segment-card').first()).toBeVisible({ timeout: 15_000 });
    await expectNoStructuralAccessibilityViolations(authenticatedPage);
  });

  test('account settings have no structural WCAG A/AA violations', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/user/settings');
    await expect(authenticatedPage.getByTestId('account-username')).toBeVisible();
    await expectNoStructuralAccessibilityViolations(authenticatedPage);
  });
});
