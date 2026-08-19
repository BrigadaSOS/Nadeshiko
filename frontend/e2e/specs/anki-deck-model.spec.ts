import { test, expect } from '../auth';
import type { Page, Route } from '@playwright/test';

const ANKI_ADDRESS = 'http://127.0.0.1:8765';

/**
 * Picking a deck fills in the note type that deck is mostly made of.
 *
 * The step this removes only exists for one reader: the one who has just
 * connected Anki and whose second dropdown has exactly one sensible answer in
 * it. The case these tests care about most is the opposite one -- a reader who
 * already chose a note type and mapped its fields must not have either replaced
 * when they change deck, because selecting a model reloads the field list and
 * any field whose name does not survive loses its mapping.
 *
 * AnkiConnect is a service on the reader's own machine, so it is mocked here the
 * same way word-mining.spec.ts mocks it: by routing the address the store posts
 * to. The mock answers per deck, which is what makes the vote meaningful rather
 * than a fixed string handed back.
 */
const DECK_NOTES: Record<string, string[]> = {
  // Overwhelmingly Lapis, with the strays a real deck accumulates.
  Mining: [...Array(18).fill('Lapis'), 'Basic', 'Cloze'],
  Starter: ['Basic', 'Basic'],
  Empty: [],
};

async function mockAnki(page: Page) {
  await page.route(`${ANKI_ADDRESS}/**`, async (route: Route) => {
    const body = route.request().postDataJSON() as { action: string; params?: any };
    const reply = (result: unknown) => route.fulfill({ json: { result, error: null } });

    switch (body.action) {
      case 'requestPermission':
        return reply({ permission: 'granted' });
      case 'deckNames':
        return reply(Object.keys(DECK_NOTES));
      case 'modelNames':
        return reply(['Basic', 'Lapis', 'Cloze']);
      case 'findNotes': {
        // The store asks with `"deck:<name>"`. Ids are encoded so `notesInfo`
        // below can tell which deck it is being asked about without the mock
        // holding state between the two calls.
        const deck = /"deck:([^"]+)"/.exec(body.params?.query ?? '')?.[1] ?? '';
        const index = Object.keys(DECK_NOTES).indexOf(deck);
        if (index < 0) return reply([]);
        return reply(DECK_NOTES[deck]!.map((_, position) => index * 1000 + position));
      }
      case 'notesInfo': {
        const ids: number[] = body.params?.notes ?? [];
        const deck = Object.keys(DECK_NOTES)[Math.floor((ids[0] ?? 0) / 1000)] ?? '';
        const models = DECK_NOTES[deck] ?? [];
        return reply(ids.map((noteId, position) => ({ noteId, modelName: models[position], fields: {}, tags: [] })));
      }
      case 'modelFieldNames':
        return reply(['Expression', 'Meaning', 'Sentence']);
      default:
        return reply(null);
    }
  });
}

/**
 * The page, with both selects returned to "nothing chosen".
 *
 * The reset is not tidiness. The profile is stored on the account, so a deck
 * left behind by an earlier test -- or an earlier run of this file -- is still
 * selected when the next one opens the page, and re-selecting the same value
 * fires no change event at all. The suggestion would then never run and the test
 * would fail claiming the feature was missing. Clearing first guarantees the
 * selection under test is a real change.
 */
const openSettings = async (page: Page) => {
  await mockAnki(page);
  await page.goto('/user/sync');
  const deck = page.getByTestId('anki-deck-select');
  const model = page.getByTestId('anki-model-select');
  // The selects only fill once the store has been round the connect handshake;
  // until then each holds nothing but its own "select…" placeholder option.
  await expect(deck.locator('option')).not.toHaveCount(1, { timeout: 20_000 });

  await deck.selectOption('');
  await model.selectOption('');
  await expect(deck).toHaveValue('');
  await expect(model).toHaveValue('');

  return { deck, model };
};

test.describe('Anki deck to note type', () => {
  test('picking a deck fills in the note type that deck is mostly made of', async ({ authenticatedPage }) => {
    const { deck, model } = await openSettings(authenticatedPage);

    await deck.selectOption('Mining');

    await expect(model).toHaveValue('Lapis', { timeout: 15_000 });
  });

  test('leaves a note type the reader already chose alone', async ({ authenticatedPage }) => {
    // The destructive case, and the reason the suggestion is conditional.
    const { deck, model } = await openSettings(authenticatedPage);
    await model.selectOption('Cloze');
    await expect(model).toHaveValue('Cloze');

    await deck.selectOption('Mining');

    // Still Cloze, despite Mining being overwhelmingly Lapis.
    await expect(model).toHaveValue('Cloze');
  });

  /**
   * Autosave says so, without interrupting.
   *
   * Everything on this page saves as you change it, so the confirmation is a
   * line that appears and then goes rather than a toast -- there are eight
   * controls here and a toast on each would fire on every pause while typing a
   * field template. Failure still toasts; that asymmetry is the design.
   */
  test('confirms a change was kept, and stops saying so', async ({ authenticatedPage }) => {
    const { deck } = await openSettings(authenticatedPage);
    const status = authenticatedPage.getByTestId('anki-save-status');

    await deck.selectOption('Starter');

    // The write is ~100ms behind a 400ms debounce, so this is the confirmation
    // the reader actually reads -- the "Saving..." flash is too short to catch.
    await expect(status).toHaveText(/Saved/i, { timeout: 15_000 });

    // And it lets go: a permanent "Saved" is indistinguishable from a stuck one.
    await expect(status).toHaveCSS('opacity', '0', { timeout: 15_000 });
  });

  test('says nothing about a deck with no notes in it', async ({ authenticatedPage }) => {
    const { deck, model } = await openSettings(authenticatedPage);

    await deck.selectOption('Empty');

    await expect(model).toHaveValue('');
  });
  /**
   * Building a field out of more than one placeholder.
   *
   * The menu used to REPLACE the field's contents, which made it a
   * one-of-these picker: a reader could type `{definition:a}<br>{definition:b}`
   * by hand but had no reason to think a field could hold two, since every
   * click wiped the last one. Appending is what makes composing reachable, and
   * the substitution fills every placeholder rather than only the first.
   */
  test('adding a second placeholder keeps the first', async ({ authenticatedPage }) => {
    const { deck, model } = await openSettings(authenticatedPage);
    const status = authenticatedPage.getByTestId('anki-save-status');

    await deck.selectOption('Mining');
    // Both settled before touching the table: the note type fills itself a
    // moment after the deck, and the field rows are rebuilt from it.
    await expect(model).toHaveValue('Lapis', { timeout: 15_000 });

    const row = authenticatedPage
      .getByTestId('anki-field-row')
      .filter({ has: authenticatedPage.getByText('Expression', { exact: true }) });
    const value = row.getByTestId('anki-field-value');
    await expect(value).toBeVisible({ timeout: 15_000 });

    // Emptied so the assertions below can be exact, then waited out. Every edit
    // here autosaves on a 400ms debounce and the profile coming back reloads the
    // table -- clicking through rows that are being replaced underneath is the
    // "element was detached from the DOM" this otherwise hits.
    // Waited all the way out, not just to "Saved": the badge lingers, so a later
    // check for it would pass on THIS write and let the next click land while
    // the table was still being rebuilt.
    const settle = async () => {
      await expect(status).toHaveText(/Saved/i, { timeout: 15_000 });
      await expect(status).toHaveCSS('opacity', '0', { timeout: 15_000 });
    };

    await value.fill('');
    await settle();

    // Scoped to this row's own menu. Every row renders its dropdown under the
    // same id, so a page-wide lookup matches the other rows' copies too and
    // lands on whichever happens to be mid-animation.
    const menu = row.getByTestId('dropdown-menu');

    // Focusing the input opens the menu -- the reader picks from the list or just
    // types -- so no explicit click on the chevron is needed to reach it.
    await value.focus();
    await expect(menu).toBeVisible();

    // The menu STAYS OPEN after a pick: adding a placeholder appends, so a reader
    // stacks several (a gloss per dictionary, a reading beside a word) from one
    // open menu rather than reopening it for each. It used to dismiss on the
    // first pick, which is what `data-nd-keep-open` on the item list now prevents.
    await menu.getByRole('button', { name: 'Word', exact: true }).click();
    await expect(value).toHaveValue('{word}');
    await expect(menu, 'the menu stays open to stack a second placeholder').toBeVisible();

    // The second one lands beside the first rather than over it, without reopening.
    await menu.getByRole('button', { name: 'Word reading', exact: true }).click();
    await expect(value).toHaveValue('{word}<br>{word-reading}');
    await settle();
  });




});
