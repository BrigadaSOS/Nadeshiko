import { beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import * as vue from 'vue';

// Supply only globals reached at import time; tests stub behavior they care about themselves.

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

// Preserve happy-dom's real storage accessors.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.sessionStorage === 'undefined') {
  Object.assign(globalThis, { localStorage: localStorageStub, sessionStorage: sessionStorageStub });
}

Object.assign(globalThis, {
  // Only persistence storage factories run at import time, not the plugin itself.
  piniaPluginPersistedstate: {
    localStorage: () => localStorageStub,
    sessionStorage: () => sessionStorageStub,
    cookies: () => localStorageStub,
  },
});

// Use real Vue reactivity so composable tests exercise computed/watch behavior, not inert doubles.
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

  markRaw: vue.markRaw,
  toRaw: vue.toRaw,
  triggerRef: vue.triggerRef,
  customRef: vue.customRef,
  defineAsyncComponent: vue.defineAsyncComponent,
  // Vue's useId provides the per-component uniqueness modal tests need.
  useId: vue.useId,

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

// Node lacks Audio; this inert double tests player bookkeeping, not browser playback.
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
      // HAVE_ENOUGH_DATA selects normal playback rather than the unbuffered iOS gesture workaround.
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

// Share one ref per key like request-local useState; SSR payload serialization is not modeled.
const nuxtState = new Map<string, unknown>();
Object.assign(globalThis, {
  useState: <T>(key: string, init?: () => T) => {
    if (!nuxtState.has(key)) nuxtState.set(key, vue.ref(init ? init() : undefined));
    return nuxtState.get(key) as vue.Ref<T>;
  },
});

// Give every test fresh Pinia, storage and request state.
beforeEach(() => {
  setActivePinia(createPinia());
  localStorageStub.clear();
  sessionStorageStub.clear();
  nuxtState.clear();
});
