import { test, expect } from '../fixtures';

test.describe('Feedback', () => {
  test('opens, obtains a deployed form token, and submits the browser payload', async ({ page }) => {
    await page.goto('/');

    const tokenResponse = page.waitForResponse(
      (response) => response.url().includes('/v1/feedback/token') && response.status() === 200,
    );
    await page.getByTestId('feedback-fab').click();
    await tokenResponse;
    await expect(page.getByTestId('feedback-modal')).toBeVisible();

    let submitted: Record<string, unknown> | null = null;
    await page.route('**/v1/feedback', async (route) => {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
    });

    await page.getByRole('textbox', { name: /feedback|message/i }).fill('E2E feedback payload');
    await page.getByTestId('feedback-modal').getByRole('button', { name: /send|submit/i }).click();

    await expect(page.getByTestId('feedback-modal')).toContainText(/thank/i);
    expect(submitted).toMatchObject({
      body: 'E2E feedback payload',
      pagePath: expect.stringMatching(/^\/(?:en\/?)?$/),
    });
    expect(typeof submitted?.formToken).toBe('string');
  });
});
