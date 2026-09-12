import { test, expect } from '../fixtures';

test.describe('Feedback', () => {
  test('opens, obtains a deployed form token, and persists the browser payload', async ({ page }) => {
    await page.goto('/');

    const tokenResponse = page.waitForResponse(
      (response) => response.url().includes('/v1/feedback/token') && response.status() === 200,
    );
    await page.getByTestId('feedback-fab').click();
    await tokenResponse;
    await expect(page.getByTestId('feedback-modal')).toBeVisible();

    const message = `E2E staging feedback ${process.env.E2E_EXPECTED_SHA ?? Date.now()}`;
    const textbox = page.getByRole('textbox', { name: /feedback|message/i });
    // The real backend rejects implausibly fast submissions as bots. Typing is
    // intentional here: a valid, aged form token makes 201 prove the controller
    // crossed its anti-automation checks and saved the row before responding.
    await textbox.pressSequentially(message, { delay: 80 });
    const submittedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/v1/feedback' && response.request().method() === 'POST',
    );
    await page.getByTestId('feedback-modal').getByRole('button', { name: /send|submit/i }).click();
    const response = await submittedResponse;

    await expect(page.getByTestId('feedback-modal')).toContainText(/thank/i);
    expect(response.status(), await response.text()).toBe(201);
  });
});
