import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

/** Records every media element the player builds, and the src it was asked to play. */
type AudioProbe = Array<{ kind: 'construct' | 'play'; src: string }>;

declare global {
  interface Window {
    __audioProbe?: AudioProbe;
    /** How many concatenated clips have been built this page load. */
    __expandedAudioBuilt?: number;
  }
}

/**
 * Wrap `window.Audio` before the app boots.
 *
 * The player never puts its element in the DOM, so which object playback
 * actually used is invisible to a snapshot — and "the expansion worked but the
 * audio was the original" is precisely the bug these specs missed for months.
 */
async function installAudioProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.__audioProbe = [];
    window.__expandedAudioBuilt = 0;
    // The concatenated clip exists as a blob URL and nothing else: it is never
    // in the DOM, never in the network log (it is built from two downloads that
    // already finished), and the only moment it becomes observable is when the
    // player is handed it. Counting the object URLs the app mints is what lets a
    // test wait for "the expanded audio is ready" instead of guessing.
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      window.__expandedAudioBuilt = (window.__expandedAudioBuilt ?? 0) + 1;
      return createObjectURL(obj);
    };
    const Native = window.Audio;
    const Wrapped = function (this: unknown, src?: string) {
      const element = new Native(src);
      const record = (kind: 'construct' | 'play') => {
        window.__audioProbe?.push({ kind, src: String(element.src || src || '') });
      };
      record('construct');
      const play = element.play.bind(element);
      element.play = () => {
        record('play');
        return play();
      };
      return element;
    } as unknown as typeof window.Audio;
    Wrapped.prototype = Native.prototype;
    window.Audio = Wrapped;
  });
}

const playedSources = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window.__audioProbe ?? []).filter((e) => e.kind === 'play').map((e) => e.src));

test.describe('Expand sentence', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    await installAudioProbe(page);
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();
  });

  const openMenu = async (card: import('@playwright/test').Locator) => {
    const dropdown = card.getByTestId('more-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();
    const menu = dropdown.getByTestId('dropdown-menu');
    await expect(menu).toBeVisible();
    return menu;
  };

  const expand = async (card: import('@playwright/test').Locator, label: string) => {
    const menu = await openMenu(card);
    const item = menu.locator('button', { hasText: label }).first();
    await expect(item).toBeEnabled();
    const context = card.page().waitForResponse((r) => r.url().includes('/context'), { timeout: 15_000 });
    await item.click();
    await context;
  };

  for (const direction of ['Expand (right)', 'Expand (left)', 'Expand (both)']) {
    test(`${direction} pulls the neighbouring text in`, async () => {
      const card = search.segmentCards.first();
      const jaText = card.getByTestId('segment-japanese-text');
      const before = await jaText.innerText();

      await expand(card, direction);

      // Either the text grew, or the segment sits at an episode boundary — in
      // which case the reader is told so rather than left with a dead button.
      await expect
        .poll(
          async () =>
            (await jaText.innerText()) !== before ||
            (await card.page().locator('.Vue-Toastification__toast').count()) > 0,
          { timeout: 10_000 },
        )
        .toBe(true);
      await expect(card).toBeVisible();
      await expect(jaText).toBeVisible();
    });
  }

  test('expanding a second time replaces the first expansion', async () => {
    const card = search.segmentCards.first();
    const jaText = card.getByTestId('segment-japanese-text');
    const original = (await jaText.innerText()).trim();

    await expand(card, 'Expand (right)');
    const afterRight = await jaText.innerText();

    // The controls must come back before the next click is accepted; while this
    // went unwired, a click landing during the audio build was silently dropped
    // and the menu item looked dead.
    await expand(card, 'Expand (left)');

    await expect.poll(async () => await jaText.innerText(), { timeout: 10_000 }).not.toBe(afterRight);
    // The right-hand expansion was reverted, not stacked on top of: the sentence
    // the reader actually searched for is still the tail of what is on screen.
    //
    // Asserted on the text rather than on a count of pulled-in spans, which is
    // what this did while the Japanese half was merged as markup. It is tokens
    // now -- one per word rather than one per neighbour -- so a count no longer
    // says anything about how many sentences were merged.
    await expect
      .poll(async () => (await jaText.innerText()).trim().endsWith(original), { timeout: 10_000 })
      .toBe(true);
  });

  test('an expansion whose audio fails can still be reverted', async ({ page }) => {
    // The pair that comes apart: the text swap lands first and the audio is
    // attached a second or two later, so an audio failure leaves a card that is
    // expanded and has no clip. Revert used to be gated on the clip -- meaning
    // the one case that most needs a way back was the one case that had none,
    // and the toast told the reader about it while offering nothing to do.
    await page.route(/\.(mp3|opus|m4a|wav)(\?|$)/, (route) =>
      route.request().resourceType() === 'fetch' ? route.abort() : route.continue(),
    );

    const card = search.segmentCards.first();
    const jaText = card.getByTestId('segment-japanese-text');
    const original = (await jaText.innerText()).trim();

    await expand(card, 'Expand (right)');
    await expect.poll(async () => (await jaText.innerText()).trim() !== original, { timeout: 10_000 }).toBe(true);

    const menu = await openMenu(card);
    const revert = menu.locator('button', { hasText: 'Revert' }).first();
    await expect(revert).toBeVisible({ timeout: 10_000 });
    await revert.click();

    // And it really goes back, rather than merely offering to.
    await expect.poll(async () => (await jaText.innerText()).trim(), { timeout: 10_000 }).toBe(original);
  });

  test('playing a segment before expanding it still yields expanded audio', async ({ page }) => {
    // The regression: a media element's request is not a CORS request, so playing
    // first left a cache entry the concatenation fetch could not reuse. The
    // expansion's audio silently failed and playback fell back to the original
    // clip — in the player and in the Anki export alike.
    const card = search.segmentCards.first();

    // Expanded audio needs the CDN to grant CORS to the origin under test, and it
    // only answers with `Access-Control-Allow-Origin` for https://nadeshiko.co.
    // Against any other base URL no expansion can ever produce audio, so asserting
    // it would fail for a reason that has nothing to do with this code.
    // The image sits in the same bucket behind the same policy as the audio, so
    // it answers the CORS question without having to guess an audio url.
    const probeUrl = await card.getByTestId('segment-image').getAttribute('src');
    test.skip(!probeUrl, 'could not resolve a CDN url to probe');
    const corsAllowed = await page.evaluate(
      (url) =>
        fetch(url as string)
          .then((r) => r.ok)
          .catch(() => false),
      probeUrl,
    );
    test.skip(!corsAllowed, `CDN grants no CORS to ${new URL(page.url()).origin}; expanded audio cannot build here`);

    await card.getByTestId('audio-play-button').click();
    await expect.poll(async () => (await playedSources(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const [firstPlayed] = await playedSources(page);
    expect(firstPlayed).not.toMatch(/^blob:/);

    await expand(card, 'Expand (right)');

    // Wait for the audio to actually exist.
    //
    // This polled `dropdown-toggle.isEnabled()` and waited for nothing at all:
    // `isExpanding` disables the menu's ITEMS, never the toggle, so the poll was
    // true on its first tick. The test then played about a second before the
    // fetch-and-decode finished and got the original clip -- the very thing it
    // exists to catch -- roughly one run in two. It was not a flake in the
    // feature; it was a test racing it and blaming it on retry.
    //
    // The text swap deliberately lands before the audio (see
    // `attachExpandedAudio`), so nothing in the rendered card marks the audio as
    // ready. The blob is the signal.
    await expect
      .poll(async () => await page.evaluate(() => window.__expandedAudioBuilt ?? 0), { timeout: 25_000 })
      .toBeGreaterThan(0);

    await card.getByTestId('audio-play-button').click();

    await expect
      .poll(async () => (await playedSources(page)).at(-1) ?? '', { timeout: 15_000 })
      .toMatch(/^blob:/);
  });
});
