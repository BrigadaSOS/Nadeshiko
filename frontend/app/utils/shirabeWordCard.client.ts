import type { DefinitionSize, WordCardHost } from '@shirabe-org/card/word-card';
import { shallowRef } from 'vue';

export const activeShirabeCardOwner = shallowRef<symbol | null>(null);
let cardModule: ReturnType<typeof importCard> | null = null;
const importCard = () => import('@shirabe-org/card/word-card');
const loadCard = () =>
  (cardModule ??= importCard().catch((error: unknown) => {
    cardModule = null;
    throw error;
  }));

/** Start loading the SDK bundle after hydration so the first click can open promptly. */
export function prepareShirabeWordCard(): void {
  void loadCard().catch(() => {
    /* The click can retry loading the module. */
  });
}
export interface ShowShirabeWordCardOptions {
  element: HTMLElement;
  host: WordCardHost;
  definitionSize: DefinitionSize;
  languages: Array<'eng' | 'spa'>;
  displayLocale: 'en' | 'es';
  labels?: { parts?: string; lookupIn?: string };
  onClose?: () => void;
}

export interface ShownShirabeWordCard {
  open: boolean;
  actionsTarget: HTMLElement | null;
}

/** Warm the SDK lookup on hover without changing the active popup or host. */
export async function prefetchShirabeWordCard(element: HTMLElement, host: WordCardHost): Promise<void> {
  try {
    const card = await loadCard();
    card.schedulePrefetch(element, host);
  } catch {
    /* Opening the card can retry loading the SDK bundle. */
  }
}

// The SDK owns the theme and layout. Nadeshiko only styles its extra controls
// and uses its existing audio icon.
const NADESHIKO_CARD_CSS = `
.sb-btn.sb-audio > span { display: none; }
.sb-btn.sb-audio::before {
  content: "";
  display: block;
  width: 18px;
  height: 18px;
  background-color: currentColor;
  -webkit-mask: url('/icons/volume-high.svg') center / contain no-repeat;
  mask: url('/icons/volume-high.svg') center / contain no-repeat;
}
.sb-popup-head { padding-right: calc(var(--sb-chrome-right) + 78px); }
.sb-chrome { right: calc(var(--sb-chrome-right) + 30px); }
.nd-card-actions { display: flex; align-items: center; flex: 1 1 auto; flex-wrap: wrap; gap: 8px; min-width: 0; }
.nd-dictionary-picks { display: flex; flex-basis: 100%; flex-wrap: wrap; gap: 5px; }
.nd-dictionary-picks span { flex-basis: 100%; color: var(--sb-ink-muted); font-size: 11px; }
.nd-dictionary-picks button { padding: 3px 7px; border: 1px solid var(--sb-outline); border-radius: 6px; background: transparent; color: var(--sb-ink-muted); font: inherit; font-size: 11px; cursor: pointer; }
.nd-dictionary-picks button[aria-pressed="true"] { border-color: var(--sb-accent); color: var(--sb-accent); }
.nd-dictionary-picks button:hover { background: var(--sb-surface-muted); }
.nd-anki-corner { position: absolute; top: 12px; right: var(--sb-chrome-right); z-index: 2; }
.nd-anki-add { display: grid; place-items: center; width: 28px; height: 24px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--sb-ink-muted); cursor: pointer; }
.nd-anki-add:hover:not(:disabled), .nd-anki-add[aria-expanded="true"] { background: var(--sb-surface-muted); color: var(--sb-ink); }
.nd-anki-add:disabled { cursor: default; opacity: .35; }
.nd-anki-add svg { width: 19px; height: 19px; fill: currentColor; }
.nd-anki-menu { position: absolute; top: calc(100% + 6px); right: 0; width: min(280px, calc(100vw - 48px)); padding: 5px; border: 1px solid var(--sb-outline); border-radius: 10px; background: var(--sb-surface); box-shadow: var(--sb-shadow); }
.nd-anki-menu button { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; border-radius: 7px; background: transparent; color: var(--sb-ink); padding: 8px; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.nd-anki-menu button:hover { background: var(--sb-surface-muted); }
.nd-anki-menu button[aria-disabled="true"] { opacity: .6; }
.nd-anki-menu svg { flex: none; width: 18px; height: 18px; fill: currentColor; }
.nd-anki-add:focus-visible, .nd-anki-menu button:focus-visible { outline: 2px solid var(--sb-accent); outline-offset: 2px; }
.nd-card-actions .nd-more-sentences { color: var(--sb-accent); text-decoration: none; font-size: 12px; font-weight: 600; line-height: 16px; }
.nd-card-actions .nd-more-sentences:hover { color: var(--sb-accent-hover); text-decoration: none; }
`;

/** Client-only bridge; the card package reads `window` at module evaluation. */
export async function toggleShirabeWordCard(options: ShowShirabeWordCardOptions): Promise<ShownShirabeWordCard> {
  const card = await loadCard();
  if (options.element.classList.contains('sb-word-open')) {
    card.dismissPopup();
    return { open: false, actionsTarget: null };
  }

  card.setCardHost(options.host);
  card.setWriteState({
    canWrite: false,
    connected: false,
    readOnly: true,
    languages: options.languages,
    displayLocale: options.displayLocale,
  });
  const actionsTarget = document.createElement('div');
  actionsTarget.className = 'nd-card-actions';
  card.setPopupOptions({
    ...card.DEFAULT_CARD_OPTIONS,
    definitionSize: options.definitionSize,
    hideAutomatically: false,
    showAuthoring: false,
    theme: 'dark',
    customCss: NADESHIKO_CARD_CSS,
    labels: options.labels,
    footer: actionsTarget,
    onClose: options.onClose,
  });
  card.showNow(options.element);
  return { open: true, actionsTarget };
}

export async function dismissShirabeWordCard(): Promise<void> {
  const card = await loadCard();
  card.dismissPopup();
}
