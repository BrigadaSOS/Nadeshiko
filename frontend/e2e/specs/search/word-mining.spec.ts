import type { Page, Route } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../../auth';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';
const ANKI_ADDRESS = 'http://127.0.0.1:8765';
const MINED_NOTE_ID = 1735689600000;

/**
 * The word card's Anki half: whether the open word is already in the reader's
 * collection, and the star that says so.
 *
 * ANKICONNECT IS STUBBED, because it has to be. The real one runs on the
 * reader's own machine, so CI has no Anki and never will -- which is exactly why
 * this feature had no test at any level, and why the interesting failures here
 * are the ones nobody would see: a probe that asks the wrong question, an answer
 * parsed into the wrong note, or a star that appears because the code defaulted
 * to "mined" when the collection never answered at all.
 *
 * The stub also records what was asked, so the query itself is asserted rather
 * than just the star that follows from it.
 */

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type AnkiCall = { action: string; params: Record<string, any> };

/**
 * @param findNotesResult What the collection answers about the open word: note
 *        ids for "already mined", `[]` for "new to this reader".
 */
async function stubAnkiConnect(page: Page, findNotesResult: number[]): Promise<AnkiCall[]> {
  const calls: AnkiCall[] = [];

  await page.route(`${ANKI_ADDRESS}/**`, async (route: Route) => {
    const request = route.request();
    // The app sends `Content-Type: application/json` in `cors` mode, so the
    // browser preflights. An unanswered OPTIONS fails the request the same way a
    // closed Anki does, and the test would then be asserting nothing.
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }

    const body = (request.postDataJSON() ?? {}) as AnkiCall;
    calls.push(body);

    const result = body.action === 'findNotes' ? findNotesResult : 1;
    return route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ result, error: null }),
    });
  });

  return calls;
}

/** A profile complete enough to mine with, including the expression field the
 *  "already mined?" question is asked against. */
async function configureAnkiProfile(page: Page): Promise<void> {
  await page.request.patch('/v1/user/preferences', {
    data: {
      ankiProfiles: [
        {
          id: 'e2e-anki-profile',
          name: 'E2E',
          deck: 'Default',
          model: 'Basic',
          fields: [{ key: 'Expression', value: '{word}' }],
          key: 'Expression',
          serverAddress: ANKI_ADDRESS,
        },
      ],
    },
  });
}

const clearAnkiProfiles = (page: Page) => page.request.patch('/v1/user/preferences', { data: { ankiProfiles: [] } });

const openMinedNoteButton = (page: Page) => page.getByRole('button', { name: /already mined/i });
const mineButton = (page: Page) => page.getByRole('button', { name: /Add this sentence/i });

test.describe('Word card mining', () => {
  test.describe.configure({ mode: 'serial' });

  test('stars a word the collection already has, and asks about the right word', async ({ page }) => {
    // Signed in fresh, then configured, then loaded: preferences are cached per
    // session cookie for 30s, so a profile written after the first render of an
    // existing session would not be in the store the card reads.
    await loginAsE2EUser(page);
    await configureAnkiProfile(page);
    const calls = await stubAnkiConnect(page, [MINED_NOTE_ID - 1000, MINED_NOTE_ID]);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      const headword = await search.openFirstTokenCard();

      await expect(openMinedNoteButton(page)).toBeVisible({ timeout: 10_000 });

      const findNotes = calls.filter((call) => call.action === 'findNotes');
      expect(findNotes.length).toBeGreaterThan(0);
      // The word the card is open on, and the reader's own deck and expression
      // field -- not a bare search of the whole collection.
      const query = String(findNotes.at(-1)?.params?.query ?? '');
      expect(query).toContain(headword);
      expect(query).toContain('Expression');
      expect(query).toContain('Default');
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  test('leaves a word the collection does not have unstarred', async ({ page }) => {
    // The star's absence is the answer for a word the reader has never mined, so
    // it has to be earned by the collection saying so.
    await loginAsE2EUser(page);
    await configureAnkiProfile(page);
    await stubAnkiConnect(page, []);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();

      // The card's Anki controls are there -- so this is "not mined", not "no
      // profile" or "card never opened", which would look the same at a glance.
      await expect(mineButton(page)).toBeVisible({ timeout: 10_000 });
      await expect(openMinedNoteButton(page)).toHaveCount(0);
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  test('asks Anki nothing when the reader has no profile', async ({ page }) => {
    // A reader who does not use Anki should cost no connection attempt at all --
    // the probe fires on every card opened, and a doomed one per word is the
    // ordinary state for most readers.
    await loginAsE2EUser(page);
    await clearAnkiProfiles(page);
    const calls = await stubAnkiConnect(page, [MINED_NOTE_ID]);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();
    await search.openFirstTokenCard();

    await expect(mineButton(page)).toHaveCount(0);
    expect(calls).toHaveLength(0);
  });
});
