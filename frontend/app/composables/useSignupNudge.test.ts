// @vitest-environment happy-dom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive } from 'vue';

import { DEPTH_PLAYS_THRESHOLD, DEPTH_SEARCHES_THRESHOLD } from '~/utils/signupNudges';

/**
 * The two asks a signed-out reader meets, and the rules that keep them from
 * becoming noise.
 *
 * The decisions themselves live in `~/utils/signupNudges` and are tested there;
 * what is here is the part that needs a browser, and the parts worth pinning are
 * the ones that protect the reader rather than the funnel:
 *
 *   - the signed-in check lives HERE rather than at each call site, so a new
 *     call site cannot forget it and ask a member to sign up;
 *   - every step is wrapped, because an account we failed to ask for is a much
 *     cheaper outcome than a download button that throws;
 *   - the counters are per VISIT: ten plays in one sitting is a reader in the
 *     middle of something, ten plays over a month is not the same person and
 *     should not get the same message;
 *   - and the ask is recorded BEFORE the toast is raised, so a throw inside the
 *     toast cannot leave a nudge that re-fires on every download.
 */
const user = reactive({ isLoggedIn: false });
const capture = vi.fn();
const openLoginModal = vi.fn();
const raiseNudgePanel = vi.fn();

vi.mock('./useNudgePanel', () => ({ raiseNudgePanel: (...a: unknown[]) => raiseNudgePanel(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useLoginModal', () => ({ openLoginModal }));
vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (key: string) => key } }));

import { useSignupNudge } from './useSignupNudge';

const NOW = new Date('2026-08-31T12:00:00Z');

/** The panel as it was raised, or undefined if none was. */
const panel = () =>
  raiseNudgePanel.mock.calls[0]?.[0] as
    | { title: string; iconPath: string; onAction: () => void; onDismiss: () => void }
    | undefined;

/** A fresh set of in-visit counters, as a new page load would have. */
async function freshVisit() {
  const nudge = useSignupNudge();
  useState('nd-nudge-plays', () => 0).value = 0;
  useState('nd-nudge-searches', () => 0).value = 0;
  return nudge;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  user.isLoggedIn = false;
  localStorage.clear();
  await freshVisit();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('after a reader saves a clip', () => {
  test('the panel offers the thing an account adds', async () => {
    (await freshVisit()).nudgeAfterDownload();

    expect(panel()?.title).toBe('signupNudge.download.title');
  });

  test('and wears the mark of the thing being offered, not a generic alert glyph', async () => {
    // `mdiFileDocumentPlusOutline` is already what the segment menu and the word
    // card use for Anki, so a reader who has met the disabled menu entry meets
    // the same symbol here, now attached to something they can press. The depth
    // panel is a different offer and says so.
    const downloadNudge = await freshVisit();
    downloadNudge.nudgeAfterDownload();
    const downloadIcon = panel()?.iconPath;

    raiseNudgePanel.mockClear();
    localStorage.clear();
    const depthNudge = await freshVisit();
    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD; play++) depthNudge.recordPlay();

    expect(downloadIcon).toBeTruthy();
    expect(panel()?.iconPath).not.toBe(downloadIcon);
  });

  test('a signed-in reader is not asked to sign up', async () => {
    // The check is here rather than at the call sites so a new one cannot
    // forget it.
    user.isLoggedIn = true;

    (await freshVisit()).nudgeAfterDownload();

    expect(raiseNudgePanel).not.toHaveBeenCalled();
  });

  test('and is not asked twice in a week', async () => {
    const nudge = await freshVisit();
    nudge.nudgeAfterDownload();

    vi.setSystemTime(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
    nudge.nudgeAfterDownload();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });
});

describe('the add menu', () => {
  test('raises the same panel, since it is the same ask', async () => {
    (await freshVisit()).nudgeOnAddMenu();

    expect(panel()?.title).toBe('signupNudge.download.title');
  });

  test('shares the download cooldown, so saving then opening the menu asks once', async () => {
    const nudge = await freshVisit();

    nudge.nudgeAfterDownload();
    nudge.nudgeOnAddMenu();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });

  test('but is credited to the menu when it is the one that asked', async () => {
    // Two triggers share a panel; which one earned the signup is the whole
    // question the attribution answers.
    (await freshVisit()).nudgeOnAddMenu();
    panel()?.onAction();

    expect(openLoginModal).toHaveBeenCalledWith('add_nudge');
  });
});

describe('a reader who is getting somewhere', () => {
  test('is asked after enough plays', async () => {
    const nudge = await freshVisit();

    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD; play++) nudge.recordPlay();

    expect(panel()?.title).toBe('signupNudge.depth.title');
  });

  test('and not before', async () => {
    const nudge = await freshVisit();

    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD - 1; play++) nudge.recordPlay();

    expect(raiseNudgePanel).not.toHaveBeenCalled();
  });

  test('is asked after enough searches too', async () => {
    const nudge = await freshVisit();

    for (let search = 0; search < DEPTH_SEARCHES_THRESHOLD; search++) nudge.recordSearch();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });

  test('counts plays and searches against their OWN thresholds', async () => {
    // Not one shared tally: a reader who has played four clips and searched
    // twice has done neither of the things the ask is for.
    const nudge = await freshVisit();

    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD - 1; play++) nudge.recordPlay();
    for (let search = 0; search < DEPTH_SEARCHES_THRESHOLD - 1; search++) nudge.recordSearch();

    expect(raiseNudgePanel).not.toHaveBeenCalled();
  });

  test('keeps counting across the whole visit, not per component', async () => {
    // `useState` is what shares the tally over a route change; a local counter
    // would restart on every page and never reach the threshold.
    const first = await freshVisit();
    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD - 1; play++) first.recordPlay();

    useSignupNudge().recordPlay();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });

  test('is not asked again on the next play', async () => {
    const nudge = await freshVisit();
    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD + 3; play++) nudge.recordPlay();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });
});

describe('what is recorded', () => {
  test('the ask, with which panel and which trigger raised it', async () => {
    (await freshVisit()).nudgeAfterDownload();

    expect(capture).toHaveBeenCalledWith('signup_nudge_shown', {
      nudge: 'download',
      trigger: 'download',
      ask_number: 1,
    });
  });

  test('which ask this is, since that is what says whether to keep asking', async () => {
    // A second ask that converts like the first justifies repeating; one that
    // converts at nothing says stop.
    const nudge = await freshVisit();
    nudge.nudgeAfterDownload();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000));
    nudge.nudgeAfterDownload();

    expect(capture).toHaveBeenLastCalledWith('signup_nudge_shown', expect.objectContaining({ ask_number: 2 }));
  });

  test('a dismissal, which silence otherwise looks identical to', async () => {
    // "Read it and said no" and "never looked at it" are both an absence after
    // `signup_nudge_shown`, and they mean opposite things about the copy.
    (await freshVisit()).nudgeAfterDownload();

    panel()?.onDismiss();

    expect(capture).toHaveBeenCalledWith('signup_nudge_dismissed', {
      nudge: 'download',
      trigger: 'download',
      ask_number: 1,
    });
  });

  test('a dismissal costs the reader’s patience DOUBLE, ending the ladder early', async () => {
    // The panel has no timeout, so silence is a "no" with many other
    // explanations available -- including never having seen a toast in the far
    // corner. Pressing "Not now" has only one, and buys a month rather than a
    // week before the next ask.
    const nudge = await freshVisit();
    nudge.nudgeAfterDownload();
    panel()?.onDismiss();

    raiseNudgePanel.mockClear();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000));
    nudge.nudgeAfterDownload();

    expect(raiseNudgePanel).not.toHaveBeenCalled();
  });

  test('while silence buys only the ordinary week', async () => {
    const nudge = await freshVisit();
    nudge.nudgeAfterDownload();

    raiseNudgePanel.mockClear();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000));
    nudge.nudgeAfterDownload();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });

  test('the ask BEFORE the panel is raised', async () => {
    // A throw inside the toast library would otherwise leave a nudge that
    // re-fires on every download for the rest of the visit.
    raiseNudgePanel.mockImplementationOnce(() => {
      throw new Error('toast library exploded');
    });
    const nudge = await freshVisit();

    nudge.nudgeAfterDownload();
    nudge.nudgeAfterDownload();

    expect(raiseNudgePanel).toHaveBeenCalledTimes(1);
  });
});

describe('accepting the ask', () => {
  test.each([
    ['nudgeAfterDownload', 'download_nudge'],
    ['nudgeOnAddMenu', 'add_nudge'],
  ] as const)('%s credits the signup to %s', async (method, gate) => {
    const nudge = await freshVisit();
    nudge[method]();

    panel()?.onAction();

    expect(openLoginModal).toHaveBeenCalledWith(gate);
  });

  test('a depth ask is credited to depth', async () => {
    const nudge = await freshVisit();
    for (let play = 0; play < DEPTH_PLAYS_THRESHOLD; play++) nudge.recordPlay();

    panel()?.onAction();

    expect(openLoginModal).toHaveBeenCalledWith('depth_nudge');
  });

  test('does nothing for a reader who signed in while the toast was up', async () => {
    // The modal state is shared and the toast sits on screen for seconds.
    (await freshVisit()).nudgeAfterDownload();

    user.isLoggedIn = true;
    panel()?.onAction();

    expect(openLoginModal).not.toHaveBeenCalled();
  });
});

describe('when something goes wrong', () => {
  test('a download still succeeds, even if the nudge cannot be raised', async () => {
    // Every caller is in the middle of something the reader asked for. An
    // account we failed to ask for is far cheaper than a download that throws.
    raiseNudgePanel.mockImplementation(() => {
      throw new Error('no toast host');
    });

    expect(() => (useSignupNudge() as ReturnType<typeof useSignupNudge>).nudgeAfterDownload()).not.toThrow();
  });

  test('a play is still counted as playable, even if the counters throw', async () => {
    const nudge = await freshVisit();
    raiseNudgePanel.mockImplementation(() => {
      throw new Error('no toast host');
    });

    expect(() => {
      for (let play = 0; play < DEPTH_PLAYS_THRESHOLD; play++) nudge.recordPlay();
    }).not.toThrow();
  });

  test('a dismissal that throws does not take the toast down with it', async () => {
    // This runs whenever the reader gets round to pressing the button, long
    // after the call stack that raised the panel is gone.
    (await freshVisit()).nudgeAfterDownload();
    capture.mockImplementation(() => {
      throw new Error('analytics is down');
    });

    expect(() => panel()?.onDismiss()).not.toThrow();
  });
});
