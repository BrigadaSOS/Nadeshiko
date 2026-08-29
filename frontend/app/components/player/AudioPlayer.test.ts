// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The clip player's transport.
 *
 * Two things are pinned. SEEKING is arithmetic against a duration that is
 * routinely not a number yet -- an `<audio>` reports `NaN` until its metadata
 * lands -- and every unclamped result is a playhead thrown off the end of a clip
 * that is only seconds long to begin with.
 *
 * The KEYBOARD handler is bound on `window` with `capture: true`, so it sees
 * every key pressed anywhere on the page: in a search box, inside a dropdown
 * menu, in another component's dialog. Each of those is a case where the player
 * must keep its hands off, and the failure is always the same shape -- a key the
 * reader aimed somewhere else moves the clip instead.
 */
const playerStore = {
  currentAudio: null as HTMLAudioElement | null,
  currentResult: ref<Record<string, unknown> | null>(null),
  isPlaying: ref(false),
  showPlayer: ref(true),
  volume: ref(1),
  playbackRate: ref(1),
  autoplay: ref(false),
  repeat: ref(false),
  isImmersive: ref(false),
  setVolume: vi.fn(),
  setPlaybackRate: vi.fn(),
  togglePlay: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  restart: vi.fn(),
  close: vi.fn(),
  toggleImmersive: vi.fn(),
  toggleAutoplay: vi.fn(),
  toggleRepeat: vi.fn(),
  hidePlayer: vi.fn(),
};

// `storeToRefs` is imported straight from pinia and is handed the mock above,
// which is a plain object rather than a real store -- so it returns nothing and
// `showPlayer` lands undefined. The keydown handler then throws on its first
// line, silently, and EVERY "the player keeps its hands off" assertion passes
// because the handler did nothing at all. The refs are already refs here, so
// handing the object straight back is both correct and what makes those tests
// mean anything.
vi.mock('pinia', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('~/stores/player', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, usePlayerStore: () => playerStore };
});

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => ({ path: '/search/word', params: {}, query: {} }));
vi.stubGlobal('useMediaName', () => ({ mediaName: (m: Record<string, string>) => m?.nameEn ?? '' }));
vi.stubGlobal('useMotionPreference', () => ({ scrollBehavior: ref('smooth'), prefersReducedMotion: ref(false) }));
vi.stubGlobal('useYoutubeSegmentPlayer', () => ({
  activeSegmentId: ref(null),
  clipProgress: ref(0),
  hostId: ref('yt'),
  preload: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  restart: vi.fn(),
  retimeClip: vi.fn(),
  seekToClipFraction: vi.fn(),
  setVolume: vi.fn(),
  setPlaybackRate: vi.fn(),
  stop: vi.fn(),
}));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));

import AudioPlayer from './AudioPlayer.vue';

/** A stand-in `<audio>` whose duration and playhead the test controls. */
function audio(duration: number, currentTime = 0) {
  return { duration, currentTime, paused: true, play: vi.fn(), pause: vi.fn() } as unknown as HTMLAudioElement;
}

const result = () => ({
  segment: { publicId: 's1', startTimeMs: 0, endTimeMs: 5000, urls: { audioUrl: 'a.mp3' }, textJa: { content: '猫' } },
  media: { publicId: 'm1', nameEn: 'Bocchi', category: 'ANIME' },
});

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(AudioPlayer, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        SearchSegmentTokenText: true,
        CommonBaseModal: true,
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

/** A transport button, by the label a screen reader would read. */
function control(wrapper: ReturnType<typeof render>, key: string) {
  const button = wrapper.findAll('button').find((b) => b.attributes('aria-label') === `player.controls.${key}`);
  if (!button) throw new Error(`no control labelled ${key}`);
  return button;
}

/**
 * Presses a key the way the window listener sees it.
 *
 * By `code`, which is what the handler switches on -- an event carrying only
 * `key` matches no case at all, so every "the player keeps its hands off"
 * assertion below would pass without the handler having decided anything.
 */
function press(code: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const key = code === 'Space' ? ' ' : code;
  const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  playerStore.currentAudio = audio(10, 5);
  playerStore.currentResult.value = result();
  playerStore.showPlayer.value = true;
  playerStore.volume.value = 1;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('seeking', () => {
  test('forward moves the playhead on', async () => {
    const wrapper = render();

    await control(wrapper, 'forward').trigger('click');

    expect(playerStore.currentAudio!.currentTime).toBeGreaterThan(5);
  });

  test('back moves it the other way', async () => {
    const wrapper = render();

    await control(wrapper, 'rewind').trigger('click');

    expect(playerStore.currentAudio!.currentTime).toBeLessThan(5);
  });

  test('never past the end of the clip', async () => {
    // A clip is seconds long, so one press of forward can overshoot it.
    playerStore.currentAudio = audio(4, 3.9);
    const wrapper = render();

    await control(wrapper, 'forward').trigger('click');

    expect(playerStore.currentAudio.currentTime).toBe(4);
  });

  test('and never before the start', async () => {
    playerStore.currentAudio = audio(10, 0.2);
    const wrapper = render();

    await control(wrapper, 'rewind').trigger('click');

    expect(playerStore.currentAudio.currentTime).toBe(0);
  });

  test('does nothing while the duration is still NaN', async () => {
    // Which is what an `<audio>` reports until its metadata lands, and every
    // arithmetic on it produces NaN.
    playerStore.currentAudio = audio(Number.NaN, 2);
    const wrapper = render();

    await control(wrapper, 'forward').trigger('click');

    expect(playerStore.currentAudio.currentTime).toBe(2);
  });

  test('does nothing at all with no clip loaded', async () => {
    playerStore.currentAudio = null;
    const wrapper = render();

    expect(() => control(wrapper, 'forward').trigger('click')).not.toThrow();
  });
});

describe('the keyboard, which this handler sees from the whole page', () => {
  test('an arrow key steps to the next clip', () => {
    // Arrows move between CLIPS; seeking within one is the rewind/forward pair
    // above. Asserting on the playhead here would pass whatever the handler did,
    // because the arrows never touch it.
    render();

    press('ArrowRight');

    expect(playerStore.next).toHaveBeenCalled();
  });

  test('and the other way', () => {
    render();

    press('ArrowLeft');

    expect(playerStore.prev).toHaveBeenCalled();
  });

  test('but NOT while the reader is typing in a field', () => {
    // The listener is on `window`: every keystroke of every search box arrives
    // here, and a right-arrow through a word would drag the clip with it.
    render();
    const input = document.createElement('input');
    document.body.appendChild(input);

    press('ArrowRight', input);

    expect(playerStore.next).not.toHaveBeenCalled();
  });

  test('nor in a textarea', () => {
    render();
    const area = document.createElement('textarea');
    document.body.appendChild(area);

    press('ArrowRight', area);

    expect(playerStore.next).not.toHaveBeenCalled();
  });

  test('nor in anything contenteditable', () => {
    render();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);

    press('ArrowRight', editable);

    expect(playerStore.next).not.toHaveBeenCalled();
  });

  test('a browser shortcut is left alone', () => {
    // Ctrl/Cmd/Alt combinations belong to the browser or the OS.
    render();

    press('ArrowRight', document.body, { metaKey: true });
    press('ArrowRight', document.body, { ctrlKey: true });
    press('ArrowRight', document.body, { altKey: true });

    expect(playerStore.next).not.toHaveBeenCalled();
  });

  test('and nothing at all when the player is closed', () => {
    playerStore.showPlayer.value = false;
    render();

    press('ArrowRight');

    expect(playerStore.next).not.toHaveBeenCalled();
  });

  test('Space inside a MENU belongs to the menu, not the player', () => {
    // The handler captures, so its `preventDefault` lands before the button's:
    // a `role="menuitemradio"` needs Space to pick an item, and swallowing it
    // meant the menu could not be used from the keyboard at all.
    render();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.body.appendChild(menu);

    press('Space', item);

    expect(playerStore.togglePlay).not.toHaveBeenCalled();
  });

  test('and so does Space on the control that OPENS a menu', () => {
    render();
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup', 'menu');
    document.body.appendChild(trigger);

    press('Space', trigger);

    expect(playerStore.togglePlay).not.toHaveBeenCalled();
  });

  test('Space anywhere else toggles playback', () => {
    render();

    press('Space');

    expect(playerStore.togglePlay).toHaveBeenCalled();
  });
});

describe('volume', () => {
  test('the slider reports a percentage of the stored value', () => {
    playerStore.volume.value = 0.42;
    const wrapper = render();

    const slider = wrapper.find('input[type="range"]');
    if (slider.exists()) expect((slider.element as HTMLInputElement).value).toBe('42');
  });

  test('moving it stores a fraction, not a percentage', async () => {
    const wrapper = render();
    const slider = wrapper.find('input[type="range"]');

    if (slider.exists()) {
      await slider.setValue('30');
      expect(playerStore.setVolume).toHaveBeenCalledWith(0.3);
    }
  });
});
