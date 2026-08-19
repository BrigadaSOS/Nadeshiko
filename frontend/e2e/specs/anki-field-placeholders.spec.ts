import { test, expect } from '../auth';
import type { Page, Route } from '@playwright/test';

const ANKI_ADDRESS = 'http://127.0.0.1:8765';
const MODEL_FIELDS = ['Expression', 'Meaning'];

/**
 * The field placeholder menu, and the one item in it that replaces the list
 * around it.
 *
 * Drilling into the dictionary picker swaps the whole menu body, which unmounts
 * the item the reader just clicked. That is the shape the container's
 * click-outside check used to get wrong: Vue's patch lands during the microtask
 * checkpoint between listeners, so by the time the click reached `document` the
 * clicked node was detached and `contains` reported it as outside -- dismissing
 * the menu on the way in. These tests are about the menu SURVIVING each step,
 * which is why every one of them asserts on the menu still being there rather
 * than only on what landed in the input.
 *
 * AnkiConnect is a service on the reader's own machine, mocked the same way
 * anki-deck-model.spec.ts mocks it. The dictionaries come from Shirabe, so that
 * endpoint is stubbed too -- a reader who has linked nothing is never offered
 * the submenu at all.
 */
async function mockAnki(page: Page) {
  await page.route(`${ANKI_ADDRESS}/**`, async (route: Route) => {
    const body = route.request().postDataJSON() as { action: string };
    const reply = (result: unknown) => route.fulfill({ json: { result, error: null } });

    switch (body.action) {
      case 'requestPermission':
        return reply({ permission: 'granted' });
      case 'deckNames':
        return reply(['Mining']);
      case 'modelNames':
        return reply(['Lapis']);
      case 'modelFieldNames':
        return reply(MODEL_FIELDS);
      case 'findNotes':
        return reply([]);
      default:
        return reply(null);
    }
  });
}

/**
 * Two dictionaries, one of them read in two languages.
 *
 * The stack entry is `slug:language` and the same pack sits in it once per
 * language, but a FIELD maps to the dictionary rather than to one language of
 * it -- so three entries must offer two rows.
 */
async function mockShirabeDictionaries(page: Page) {
  await page.route('**/v1/user/connections/shirabe', (route: Route) =>
    route.fulfill({
      json: {
        connection: {
          dictionaries: ['sanseido:ja', 'jmdict:en', 'jmdict:es'],
          dictionaryNames: { sanseido: '三省堂国語辞典', jmdict: 'JMdict' },
        },
      },
    }),
  );
}

/** The settings page with one note type chosen, which is what puts field rows
 *  on screen: the table is built from the model's own field names. */
const openFieldTable = async (page: Page) => {
  await mockAnki(page);
  await mockShirabeDictionaries(page);
  // The profile lives on the account, so a field template left behind by an
  // earlier spec -- or an earlier run of this one -- would still be in the input
  // these tests assert the exact contents of. Cleared rather than overwritten:
  // the page makes itself a fresh profile when it finds none.
  await page.request.patch('/v1/user/preferences', { data: { ankiProfiles: [] } });
  await page.goto('/user/sync');

  const model = page.getByTestId('anki-model-select');
  // Until the store has been round the connect handshake the select holds
  // nothing but its own "select..." placeholder option.
  await expect(model.locator('option')).not.toHaveCount(1, { timeout: 20_000 });
  await model.selectOption('Lapis');

  // `data-field` is on the row itself rather than on a cell inside it, so this
  // is one selector and not a `filter({ has })`.
  const row = page.locator('[data-testid="anki-field-row"][data-field="Expression"]');
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
};

test.describe('Anki field placeholder menu', () => {
  test('drilling into the dictionary list keeps the menu open', async ({ authenticatedPage }) => {
    const row = await openFieldTable(authenticatedPage);
    const menu = row.getByTestId('dropdown-menu');

    // Focusing the input is what opens the menu -- the chevron is a second way
    // in, not the only one.
    await row.getByTestId('anki-field-value').click();
    await expect(menu).toBeVisible();

    await row.getByTestId('anki-dictionary-submenu').click();

    // The regression: the menu is still here, now showing the level below.
    await expect(menu).toBeVisible();
    await expect(row.getByTestId('anki-dictionary-option')).toHaveCount(2);
    await expect(row.getByTestId('anki-dictionary-submenu')).toHaveCount(0);
  });

  test('coming back out of the dictionary list keeps the menu open', async ({ authenticatedPage }) => {
    const row = await openFieldTable(authenticatedPage);
    const menu = row.getByTestId('dropdown-menu');

    await row.getByTestId('anki-field-value').click();
    await row.getByTestId('anki-dictionary-submenu').click();
    await expect(row.getByTestId('anki-dictionary-option')).toHaveCount(2);

    // Back swaps the body the same way going in did, so it fails the same way.
    await row.getByTestId('anki-dictionary-back').click();

    await expect(menu).toBeVisible();
    await expect(row.getByTestId('anki-dictionary-submenu')).toBeVisible();
  });

  /** Picking APPENDS, so the menu stays open to stack a second one -- the
   *  reason the whole body carries `data-nd-keep-open`. */
  test('naming a dictionary appends it and leaves the list up', async ({ authenticatedPage }) => {
    const row = await openFieldTable(authenticatedPage);
    const input = row.getByTestId('anki-field-value');

    await input.click();
    await row.getByTestId('anki-dictionary-submenu').click();
    await row.getByTestId('anki-dictionary-option').first().click();

    await expect(input).toHaveValue('{definition:sanseido}');
    await expect(row.getByTestId('dropdown-menu')).toBeVisible();

    // And a second, onto the same field, without reopening anything.
    await row.getByTestId('anki-dictionary-option').nth(1).click();
    await expect(input).toHaveValue('{definition:sanseido}<br>{definition:jmdict}');
  });

  /** The menu still has to close when the reader is actually done with it. */
  test('closes on a click outside it', async ({ authenticatedPage }) => {
    const row = await openFieldTable(authenticatedPage);
    const menu = row.getByTestId('dropdown-menu');

    await row.getByTestId('anki-field-value').click();
    await expect(menu).toBeVisible();

    // The table's own header: inside the card, outside the dropdown, and
    // neither a link nor a control that opens something of its own.
    await authenticatedPage.locator('thead').first().click();

    await expect(menu).toHaveCount(0);
  });
});
