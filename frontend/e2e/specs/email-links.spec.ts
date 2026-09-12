import { test, expect } from '../fixtures';

test.describe('Email links', () => {
  test('rejects a verification link without a token', async ({ page }) => {
    const response = await page.goto('/verify');
    expect(response?.status()).toBe(400);
  });

  test('forwards a legacy verification token without allowing an external callback', async ({ page }) => {
    let forwardedUrl = '';
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/v1/auth/verify-email') forwardedUrl = request.url();
    });

    const response = await page.goto(
      '/verify?token=legacy-token&callbackURL=https%3A%2F%2Fevil.example%2Fsteal',
    );
    expect(response?.status()).toBe(200);

    const target = new URL(forwardedUrl);
    expect(target.searchParams.get('token')).toBe('legacy-token');
    expect(target.searchParams.get('callbackURL')).toBe(`${target.origin}/user/settings`);
  });

  test('shows an invalid state when an unsubscribe token is missing', async ({ page }) => {
    await page.goto('/unsubscribe');
    await expect(page.getByText('This unsubscribe link is not valid')).toBeVisible();
    await expect(page.getByTestId('unsubscribe-all')).toHaveCount(0);
  });

  test('shows a safe failure when the unsubscribe token is rejected', async ({ page }) => {
    await page.route('**/v1/email/preferences**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'VALIDATION_FAILED', message: 'Invalid token' }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/unsubscribe?token=invalid-token');
    await expect(page.getByText('This unsubscribe link is not valid')).toBeVisible();
    await expect(page.getByTestId('unsubscribe-all')).toHaveCount(0);
  });

  test('changes one email category and the master preference only after a click', async ({ page }) => {
    const state = {
      enabled: true,
      categories: { recap: true, checkins: true, updates: true },
    };
    const updates: Array<Record<string, unknown>> = [];

    await page.route('**/v1/email/preferences**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { ...state, category: 'recap' } });
        return;
      }

      const body = route.request().postDataJSON() as Record<string, unknown>;
      updates.push(body);
      if (typeof body.enabled === 'boolean') state.enabled = body.enabled;
      for (const category of ['recap', 'checkins', 'updates'] as const) {
        if (typeof body[category] === 'boolean') state.categories[category] = body[category] as boolean;
      }
      await route.fulfill({ json: { ...state, category: 'recap' } });
    });

    await page.goto('/unsubscribe?token=valid-token');
    const recap = page.getByTestId('unsubscribe-recap');
    const all = page.getByTestId('unsubscribe-all');
    await expect(recap).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(updates).toEqual([]);

    await recap.click();
    await expect(recap).toHaveAttribute('aria-pressed', 'false');
    expect(updates[0]).toMatchObject({ token: 'valid-token', recap: false });

    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(recap).toBeDisabled();
    expect(updates[1]).toMatchObject({ token: 'valid-token', enabled: false });

    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(recap).toBeEnabled();
    expect(updates[2]).toMatchObject({ token: 'valid-token', enabled: true });
  });
});
