import { test, expect } from '../fixtures';

const openLoginModal = async (page: import('@playwright/test').Page, path = '/search/auth-modal-target') => {
  await page.context().clearCookies();
  await page.goto(path);
  await page.getByTestId('profile-dropdown').getByTestId('dropdown-toggle').click();
  await page.getByTestId('nav-login').click();
  const modal = page.getByTestId('login-modal');
  await expect(modal).toBeVisible();
  return modal;
};

test.describe('Authentication modal', () => {
  test('requires an email before it can request a magic link', async ({ page }) => {
    let requests = 0;
    await page.route('**/v1/auth/sign-in/magic-link', async (route) => {
      requests += 1;
      await route.fulfill({ json: {} });
    });

    const modal = await openLoginModal(page);
    const email = modal.getByTestId('magic-link-email');
    const send = modal.getByTestId('magic-link-send');

    await expect(send).toBeDisabled();
    await email.fill('   ');
    await expect(send).toBeDisabled();
    expect(requests).toBe(0);

    await email.fill('reader@example.test');
    await expect(send).toBeEnabled();
  });

  test('sends a magic-link request and explains both wrong-code outcomes', async ({ page }) => {
    let magicLinkBody: Record<string, unknown> | undefined;
    let codeAttempt = 0;

    await page.route('**/v1/auth/sign-in/magic-link', async (route) => {
      magicLinkBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/v1/auth/sign-in/email-otp', async (route) => {
      codeAttempt += 1;
      const body = codeAttempt === 1
        ? { code: 'LOGIN_CODE_NOT_BOUND', message: 'This code belongs to another browser' }
        : { code: 'INVALID_OTP', message: 'Invalid code' };
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(body) });
    });

    const modal = await openLoginModal(page);
    await modal.getByTestId('magic-link-email').fill('reader@example.test');
    await modal.getByTestId('magic-link-send').click();

    await expect(modal.getByTestId('magic-link-sent')).toContainText('reader@example.test');
    expect(magicLinkBody).toMatchObject({ email: 'reader@example.test' });
    expect(String(magicLinkBody?.callbackURL)).toContain('magic_callback=1');

    const code = modal.getByTestId('magic-link-code');
    const submit = modal.getByTestId('magic-link-code-submit');
    await code.fill('ABC123');
    await submit.click();
    await expect(modal.getByTestId('magic-link-code-error')).toContainText('not requested from this browser');

    await code.fill('BAD999');
    await submit.click();
    await expect(modal.getByTestId('magic-link-code-error')).toContainText('code is not right');
    expect(codeAttempt).toBe(2);
  });

  test('renders the server retry window when magic-link delivery is rate limited', async ({ page }) => {
    await page.route('**/v1/auth/sign-in/magic-link', async (route) => {
      await route.fulfill({
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '90' },
        body: JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' }),
      });
    });

    const modal = await openLoginModal(page);
    await modal.getByTestId('magic-link-email').fill('reader@example.test');
    await modal.getByTestId('magic-link-send').click();

    await expect(modal.getByTestId('magic-link-sent')).toBeVisible();
    await expect(modal.getByTestId('magic-link-error')).toContainText('as many sign-in emails');
    await expect(modal).toContainText('90s');
    await expect(modal.getByTestId('magic-link-resend')).toHaveCount(0);
  });

  test('parks the current page before a provider redirect', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requestBody: Record<string, unknown> | undefined;

    await page.route('**/v1/auth/sign-in/social', async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await held;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PROVIDER_UNAVAILABLE', message: 'Provider unavailable' }),
      });
    });

    const modal = await openLoginModal(page, '/search/provider-return-target?category=anime');
    await modal.getByTestId('auth-provider-google').click();
    await expect.poll(() => requestBody).toMatchObject({ provider: 'google' });

    const parked = JSON.parse((await page.evaluate(() => sessionStorage.getItem('nd-auth-return-to'))) ?? 'null') as {
      path?: string;
    } | null;
    expect(parked?.path).toMatch(/\/search\/provider-return-target\?category=anime$/);
    expect(String(requestBody?.callbackURL)).toContain('/auth/callback');

    release();
    await expect(modal).toBeVisible();
  });
});
