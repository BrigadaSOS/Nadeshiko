import { beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import * as vue from 'vue';

/**
 * The Nuxt-injected globals that app modules reach for at IMPORT time.
 *
 * Auto-imports Nuxt resolves during its own build simply do not exist under
 * vitest. Most are called inside functions, so a test can stub whichever it
 * needs; these few are evaluated as a module is loaded -- `player.ts` builds its
 * `persist` option in the `defineStore` call -- which means the import throws
 * before any test body runs and the whole file fails to collect.
 *
 * Deliberately minimal: this exists so modules can be imported, not so they can
 * be tested without saying what they expect. Anything a test cares about it
 * stubs itself.
 */

/** An in-memory Storage, since `node` has neither localStorage nor sessionStorage. */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => void entries.set(k, String(v)),
    removeItem: (k: string) => void entries.delete(k),
    clear: () => entries.clear(),
  } as Storage;
}

const localStorageStub = createMemoryStorage();
const sessionStorageStub = createMemoryStorage();

// A file that opts into `happy-dom` already has both, and overwriting the DOM's
// own accessors there would be a worse double than the real thing.
if (!('localStorage' in globalThis)) {
  Object.assign(globalThis, { localStorage: localStorageStub, sessionStorage: sessionStorageStub });
}

Object.assign(globalThis, {
  // `@pinia/nuxt`'s persistence plugin. Only its storage factories are reached
  // at import time; the plugin itself never runs, so nothing is persisted.
  piniaPluginPersistedstate: {
    localStorage: () => localStorageStub,
    sessionStorage: () => sessionStorageStub,
    cookies: () => localStorageStub,
  },
});

/**
 * Vue's reactivity and lifecycle API, which Nuxt auto-imports into every
 * composable and component.
 *
 * The REAL implementations, not doubles: a composable's behaviour is mostly its
 * `computed` and `watch` graph, and a stubbed `ref` would leave a test asserting
 * against a plain object while proving nothing about what the app does.
 */
Object.assign(globalThis, {
  ref: vue.ref,
  shallowRef: vue.shallowRef,
  computed: vue.computed,
  reactive: vue.reactive,
  readonly: vue.readonly,
  toRef: vue.toRef,
  toRefs: vue.toRefs,
  unref: vue.unref,
  isRef: vue.isRef,
  watch: vue.watch,
  watchEffect: vue.watchEffect,
  nextTick: vue.nextTick,
  effectScope: vue.effectScope,
  onScopeDispose: vue.onScopeDispose,
  onMounted: vue.onMounted,
  onBeforeUnmount: vue.onBeforeUnmount,
  onUnmounted: vue.onUnmounted,
  provide: vue.provide,
  inject: vue.inject,
  // `markRaw` matters beyond convenience: the player store wraps its media
  // element in it, because a DOM handle is not state to make reactive or to
  // serialize into the SSR payload.
  markRaw: vue.markRaw,
  toRaw: vue.toRaw,
  triggerRef: vue.triggerRef,
  customRef: vue.customRef,
  defineAsyncComponent: vue.defineAsyncComponent,
  // Nuxt auto-imports its own `useId`, but Vue's has the property that matters
  // here -- a distinct id per component instance -- which is what lets two
  // stacked modals tell each other apart.
  useId: vue.useId,
  // The rest of the composition API an SFC's `<script setup>` reaches for.
  useAttrs: vue.useAttrs,
  useSlots: vue.useSlots,
  useTemplateRef: vue.useTemplateRef,
  getCurrentInstance: vue.getCurrentInstance,
  onActivated: vue.onActivated,
  onDeactivated: vue.onDeactivated,
  onUpdated: vue.onUpdated,
  onErrorCaptured: vue.onErrorCaptured,
  shallowReactive: vue.shallowReactive,
  toValue: vue.toValue,
  h: vue.h,
});

/**
 * A media element, for the stores and composables that build one.
 *
 * `node` has no `Audio`, and the player store constructs one per clip. This is
 * an inert double: it records what was set on it and never loads anything, so a
 * test asserts the store's own bookkeeping rather than the browser's.
 */
if (!('Audio' in globalThis)) {
  Object.assign(globalThis, {
    Audio: class {
      src = '';
      preload = '';
      volume = 1;
      playbackRate = 1;
      preservesPitch = false;
      currentTime = 0;
      paused = true;
      // HAVE_ENOUGH_DATA. The store takes a different path for an unbuffered
      // element -- a gesture-window play/pause dance for iOS -- and a test that
      // wanted the ordinary path would otherwise silently exercise that one.
      readyState = 4;
      onended: unknown = null;
      play = () => Promise.resolve();
      pause() {
        this.paused = true;
      }
      load() {}
      addEventListener() {}
      removeEventListener() {}
    },
  });
}

/**
 * Nuxt's `useState`: one ref per key, shared by every caller in a request.
 *
 * Faithful on the property composables actually rely on -- two calls with the
 * same key see the same ref -- and deliberately not on SSR payload
 * serialisation, which no test here exercises. Cleared between tests, which is
 * what a fresh request would do.
 */
const nuxtState = new Map<string, unknown>();
Object.assign(globalThis, {
  useState: <T>(key: string, init?: () => T) => {
    if (!nuxtState.has(key)) nuxtState.set(key, vue.ref(init ? init() : undefined));
    return nuxtState.get(key) as vue.Ref<T>;
  },
});

// A store instantiated without an active Pinia throws, and every store test
// would otherwise open by creating one. Tests that need isolation between
// cases still get it: this runs before each.
beforeEach(() => {
  setActivePinia(createPinia());
  localStorageStub.clear();
  sessionStorageStub.clear();
  nuxtState.clear();
});
