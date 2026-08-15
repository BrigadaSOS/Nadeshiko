import type { Page, Route } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../../auth';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';
const ANKI_ADDRESS = 'http://127.0.0.1:8765';
const MINED_NOTE_ID = 1735689600000;
/** What the last-added-card fallback finds: a note some other tool made a moment
 *  ago, which is a different note from the one the probe finds for a word. */
const LAST_ADDED_NOTE_ID = 1735689700000;

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
async function stubAnkiConnect(
  page: Page,
  findNotesResult: number[],
  options: { onlyOutsideDeck?: boolean } = {},
): Promise<AnkiCall[]> {
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

    return route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ result: ankiResult(body, findNotesResult, options), error: null }),
    });
  });

  return calls;
}

/**
 * What a stubbed collection answers, per action.
 *
 * `notesInfo` has to be a real note array rather than the blanket `1` the rest
 * get: the export reads `result[0].noteId` off it to decide what to write to,
 * and a truthy non-array makes it bail with `no_note_info` before any field is
 * built -- so a test asserting on `updateNoteFields` would sit waiting for a
 * call that was never going to come, and fail as a timeout rather than as the
 * thing it meant to check.
 */
function ankiResult(
  call: AnkiCall,
  findNotesResult: number[],
  options: { onlyOutsideDeck?: boolean } = {},
): unknown {
  if (call.action === 'findNotes') {
    // Two different questions reach `findNotes`, and a stub that answers both
    // the same way cannot tell the export's three targets apart. The probe asks
    // "is this WORD in the collection?"; the last-added-card fallback asks "what
    // was added recently?", which is the only one carrying `added:`. Answering
    // the fallback with the probe's result would make a word the reader has
    // never mined look like it has a card waiting.
    const query = String(call.params?.query ?? '');
    if (query.includes('added:')) return [LAST_ADDED_NOTE_ID];
    // A collection holding the word somewhere OTHER than the mining deck: the
    // deck-scoped probe finds nothing, the collection-wide one finds it. This is
    // the shape that used to end in "cannot create note because it is a
    // duplicate", because Anki's own check ignores decks.
    if (options.onlyOutsideDeck) return query.includes('deck:') ? [] : findNotesResult;
    return findNotesResult;
  }
  if (call.action === 'notesInfo') {
    const notes = (call.params?.notes ?? []) as number[];
    return notes.map((noteId) => ({ noteId, fields: {}, tags: [], cards: [], modelName: 'Basic', mod: 0, profile: '' }));
  }
  // The name the file was stored under, which is what the field is built from.
  if (call.action === 'storeMediaFile') return String(call.params?.filename ?? 'stored.mp3');
  if (call.action === 'guiBrowse') return [];
  return 1;
}

/** The headword the stubbed dictionary answers with, whichever token is opened. */
const STUB_HEADWORD = '手加減';

/**
 * A fixed dictionary answer, so the assertions below are about our rendering
 * rather than about whatever Shirabe happens to say today. The route is the
 * Nuxt proxy, not Shirabe itself -- stubbing at the browser's edge keeps the
 * server route's own caching and fallbacks out of the test.
 */
async function stubShirabeWord(page: Page, word: unknown = STUB_WORD): Promise<void> {
  await page.route('**/api/shirabe/words/**', (route: Route) =>
    word === null
      ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(word) }),
  );
}

const STUB_WORD = {
  id: 'tekagen',
  headword: STUB_HEADWORD,
  reading: 'てかげん',
  common: true,
  jlpt: 'N1',
  furigana: [{ text: STUB_HEADWORD, ruby: 'てかげん' }],
  pitch: [{ downstep: 0, audioUrl: 'https://cdn.example.test/tekagen-0.mp3' }],
  entries: [
    {
      dictionary: 'jmdict',
      senses: [
        {
          definitions: [{ lang: 'en', text: 'allowance' }],
          tags: [{ category: 'partOfSpeech', code: 'n', label: 'noun (common) (futsuumeishi)' }],
        },
      ],
    },
  ],
};

/** Every word-level placeholder, each in its own field, so one mine can be
 *  asserted against all of them. */
const WORD_FIELDS = [
  { key: 'Expression', value: '{word}' },
  { key: 'Reading', value: '{word-reading}' },
  { key: 'Furigana', value: '{word-furigana}' },
  { key: 'Definition', value: '{definition}' },
  { key: 'Pitch', value: '{word-pitch}' },
  { key: 'PitchNum', value: '{word-pitch-num}' },
  { key: 'WordAudio', value: '{word-audio}' },
  { key: 'Info', value: '{word-info}' },
  { key: 'SentenceMarked', value: '{content_jp_highlight}' },
];

/** The fields of the last note the export wrote. */
function writtenFields(calls: AnkiCall[]): Record<string, string> {
  const write = calls.filter((call) => call.action === 'updateNoteFields').at(-1);
  return (write?.params?.note?.fields ?? {}) as Record<string, string>;
}

/** A profile complete enough to mine with, including the expression field the
 *  "already mined?" question is asked against. */
async function configureAnkiProfile(
  page: Page,
  fields: Array<{ key: string; value: string }> = [{ key: 'Expression', value: '{word}' }],
  extra: { openBrowserOnExport?: boolean } = {},
): Promise<void> {
  await page.request.patch('/v1/user/preferences', {
    data: {
      ankiProfiles: [
        {
          id: 'e2e-anki-profile',
          name: 'E2E',
          deck: 'Default',
          model: 'Basic',
          fields,
          key: 'Expression',
          serverAddress: ANKI_ADDRESS,
          ...extra,
        },
      ],
    },
  });
}

const clearAnkiProfiles = (page: Page) => page.request.patch('/v1/user/preferences', { data: { ankiProfiles: [] } });

/**
 * The word card's single mining control, which changes shape with the answer.
 *
 * A word already in the collection gets a menu -- looking at the card and adding
 * this sentence to it are different verbs that no two 16px icons told apart -- so
 * the assertions below open it before clicking an item. A word that is new gets a
 * plain button, because there is only one thing to do.
 */
const minedMenuButton = (page: Page) => page.getByTestId('word-mined-menu');
const mineButton = (page: Page) => page.getByTestId('word-mine');

/** Mines this sentence, whichever of the two shapes the control is in. */
async function mine(page: Page): Promise<void> {
  if (await minedMenuButton(page).isVisible().catch(() => false)) {
    await minedMenuButton(page).click();
    // Scoped to the open menu: the trigger's own label would otherwise match too.
    await page.getByTestId('dropdown-menu').getByRole('button', { name: /Replace everything/i }).click();
    return;
  }
  await mineButton(page).click();
}

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

      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });

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
      await expect(minedMenuButton(page)).toHaveCount(0);
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  test('writes the open word -- definition, pitch, audio -- onto the note', async ({ page }) => {
    // The point of the whole feature: what the reader is looking at on the card
    // is what lands on the card they review. Shirabe is stubbed so the assertion
    // is about our rendering rather than about today's dictionary content.
    await loginAsE2EUser(page);
    await configureAnkiProfile(page, WORD_FIELDS);
    await stubShirabeWord(page);
    const calls = await stubAnkiConnect(page, [MINED_NOTE_ID]);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();
      // The star means the probe answered, so the lookup has landed too and the
      // card is showing the stubbed entry rather than the token's own fallback.
      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });

      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const fields = writtenFields(calls);
      expect(fields.Expression).toBe(STUB_HEADWORD);
      expect(fields.Reading).toBe('てかげん');
      expect(fields.Furigana).toBe('手加減[てかげん]');
      // Inline styles, not just classes: Anki's editor applies none of the note
      // type's Styling, so a definition carrying only class names rendered there
      // as one unbroken run of text.
      expect(fields.Definition).toContain('nd-senses');
      expect(fields.Definition).toContain('style=');
      expect(fields.Definition).toContain('display:block');
      expect(fields.Definition).toContain('allowance');
      expect(fields.Definition).toContain('View on shirabe.org');
      expect(fields.Definition).toContain('shirabe.org/');
      expect(fields.Pitch).toContain('nd-mora');
      // The position as plain text, so a template that parses its pitch field
      // for digits cannot read our inline styles as extra accents.
      expect(fields.PitchNum).toBe('0');
      expect(fields.PitchNum).not.toContain('<');
      expect(fields.Info).toContain('N1');
      // Uploaded by URL under a name derived from the reading and the accent.
      expect(fields.WordAudio).toBe('[sound:nadeshiko-word-てかげん-0.mp3]');

      // The sentence, with the word the reader actually clicked marked inside
      // it -- the plain `{sentence-jp}` field is unaffected and still plain.
      expect(fields.SentenceMarked).toContain('nd-target');
      expect(fields.SentenceMarked).toMatch(/<b class="nd-target">[^<]+<\/b>/);

      const stored = calls.filter((call) => call.action === 'storeMediaFile');
      expect(stored.at(-1)?.params?.url).toBe('https://cdn.example.test/tekagen-0.mp3');
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  test('leaves the word fields alone when the dictionary has no entry', async ({ page }) => {
    // The safety property. A word-level field is only ever filled from a lookup,
    // and the export paths that have no selected word must not blank it -- on a
    // Yomitan-made note that field holds the definition Yomitan wrote. A word
    // with no entry reaches the same skip, and is the case a browser can drive.
    await loginAsE2EUser(page);
    await configureAnkiProfile(page, WORD_FIELDS);
    await stubShirabeWord(page, null);
    const calls = await stubAnkiConnect(page, [MINED_NOTE_ID]);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();
      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });

      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const fields = writtenFields(calls);
      // Absent, not empty: the key must never reach Anki, because writing '' is
      // what would erase what is already there.
      expect(fields).not.toHaveProperty('Definition');
      expect(fields).not.toHaveProperty('Pitch');
      expect(fields).not.toHaveProperty('WordAudio');
      expect(fields).not.toHaveProperty('Info');
      // The word itself still lands -- the token knows it without a dictionary.
      expect(fields.Expression).toBeTruthy();
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  test('creates a note for a word the collection does not have', async ({ page }) => {
    // The word card as a miner in its own right. Nothing else made a note first,
    // so there is nothing to update -- before this the export gave up here with
    // "add a card first".
    await loginAsE2EUser(page);
    await configureAnkiProfile(page, WORD_FIELDS);
    await stubShirabeWord(page);
    const calls = await stubAnkiConnect(page, []);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();
      await expect(mineButton(page)).toBeVisible({ timeout: 10_000 });

      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'addNote').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const note = calls.filter((call) => call.action === 'addNote').at(-1)?.params?.note;
      expect(note?.deckName).toBe('Default');
      expect(note?.modelName).toBe('Basic');
      expect(note?.fields?.Expression).toBe(STUB_HEADWORD);
      expect(note?.fields?.Definition).toContain('allowance');
      expect(note?.tags).toContain('nadeshiko');
      // Anki's own duplicate check stays on as a backstop to the probe.
      expect(note?.options?.allowDuplicate).toBe(false);

      // Creating REPLACES the update, rather than happening alongside it.
      expect(calls.filter((call) => call.action === 'updateNoteFields')).toHaveLength(0);
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  test('updates the last added card, not a new note, when the word is not mapped to the key field', async ({
    page,
  }) => {
    // The setup that came first: Yomitan names Expression and fills it, and
    // Nadeshiko maps only the sentence. A note created here would carry an empty
    // Expression, so the next probe would miss it and mining the same word again
    // would make another -- a duplicate per visit, reported by nothing.
    await loginAsE2EUser(page);
    await configureAnkiProfile(page, [{ key: 'Sentence', value: '{sentence-jp}' }]);
    await stubShirabeWord(page);
    const calls = await stubAnkiConnect(page, []);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();
      await expect(mineButton(page)).toBeVisible({ timeout: 10_000 });

      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      expect(calls.filter((call) => call.action === 'addNote')).toHaveLength(0);
      // And it went to the card something else just added, exactly as before.
      const write = calls.filter((call) => call.action === 'updateNoteFields').at(-1);
      expect(write?.params?.note?.id).toBe(LAST_ADDED_NOTE_ID);
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  /**
   * Whether mining a word yanks Anki to the front, which is a per-profile
   * choice and separate from the button that exists to do exactly that.
   *
   * Untested until now, and the failure would have been silent in the annoying
   * direction: a reader who turned it off kept having Anki steal focus mid-
   * sentence, with nothing in the app to suggest the switch had not taken.
   */
  test('opens the Anki browser after mining, unless the reader turned that off', async ({ page }) => {
    await loginAsE2EUser(page);
    await stubShirabeWord(page);

    // On by default.
    await configureAnkiProfile(page, WORD_FIELDS);
    let calls = await stubAnkiConnect(page, [MINED_NOTE_ID]);
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();
      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });
      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);
      await expect
        .poll(() => calls.filter((call) => call.action === 'guiBrowse').length, { timeout: 10_000 })
        .toBeGreaterThan(0);

      // And off, on a fresh page so the profile is re-read.
      await configureAnkiProfile(page, WORD_FIELDS, { openBrowserOnExport: false });
      calls = await stubAnkiConnect(page, [MINED_NOTE_ID]);
      await search.goto(QUERY);
      await search.expectResultsVisible();
      await search.openFirstTokenCard();
      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });
      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      // The note was written; Anki was left where it was.
      expect(calls.filter((call) => call.action === 'guiBrowse')).toHaveLength(0);
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  /**
   * A word already mined into some OTHER deck.
   *
   * The probe is scoped to the profile's deck; the duplicate check Anki runs at
   * `addNote` is scoped to the note type and ignores decks entirely. While those
   * disagreed, such a word looked new here, offered to create a note, and was
   * refused with "cannot create note because it is a duplicate" -- an error the
   * reader could do nothing about, on a word they demonstrably already had.
   *
   * The card must recognise it and offer the note instead, which is the whole
   * point: no `addNote` is attempted at all.
   */
  test('recognises a word mined into another deck instead of trying to duplicate it', async ({ page }) => {
    await loginAsE2EUser(page);
    await configureAnkiProfile(page, WORD_FIELDS);
    await stubShirabeWord(page);
    const calls = await stubAnkiConnect(page, [MINED_NOTE_ID], { onlyOutsideDeck: true });

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();

      // The menu, not the plain create button: the collection was asked twice
      // and the second answer found the note.
      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });
      await expect(mineButton(page)).toHaveCount(0);

      await mine(page);
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      // Updated the note it found. Creating is what produced the duplicate error.
      expect(calls.filter((call) => call.action === 'addNote')).toHaveLength(0);
    } finally {
      await clearAnkiProfiles(page);
    }
  });

  /**
   * The two writes a reader can choose between on a card they already have.
   *
   * "Keeping your definitions" exists for the collection that came first: a note
   * whose glossary Yomitan wrote, or the reader wrote, which they want this
   * sentence and its media added to WITHOUT their own work being overwritten.
   * The distinction is only real if the word fields are genuinely left out, so
   * that is what is asserted -- the sentence lands either way, and the
   * definition only lands on the one that says it will.
   */
  test('adds context without touching the word fields, and replaces them when asked', async ({ page }) => {
    await loginAsE2EUser(page);
    await configureAnkiProfile(page, WORD_FIELDS);
    await stubShirabeWord(page);
    const calls = await stubAnkiConnect(page, [MINED_NOTE_ID]);

    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    try {
      await search.openFirstTokenCard();
      await expect(minedMenuButton(page)).toBeVisible({ timeout: 10_000 });

      await minedMenuButton(page).click();
      await page
        .getByTestId('dropdown-menu')
        .getByRole('button', { name: /keeping your definitions/i })
        .click();
      await expect
        .poll(() => calls.filter((call) => call.action === 'updateNoteFields').length, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const context = writtenFields(calls);
      // The sentence went on...
      expect(context.SentenceMarked).toContain('nd-target');
      // ...and the reader's own glossary was left exactly as it was.
      expect(context).not.toHaveProperty('Definition');
      expect(context).not.toHaveProperty('Reading');
      expect(context).not.toHaveProperty('Pitch');
      expect(context).not.toHaveProperty('PitchNum');
      expect(context).not.toHaveProperty('WordAudio');

      // The other item writes them.
      await mine(page);
      await expect
        .poll(() => Object.keys(writtenFields(calls)).includes('Definition'), { timeout: 15_000 })
        .toBe(true);
      expect(writtenFields(calls).Definition).toContain('allowance');
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
