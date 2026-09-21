// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { setCardHost, setWriteState, setPopupOptions, showNow, schedulePrefetch, dismissPopup } = vi.hoisted(() => ({
  setCardHost: vi.fn(),
  setWriteState: vi.fn(),
  setPopupOptions: vi.fn(),
  showNow: vi.fn(),
  schedulePrefetch: vi.fn(),
  dismissPopup: vi.fn(),
}));
vi.mock('@shirabe-org/card/word-card', () => ({
  DEFAULT_CARD_OPTIONS: { theme: 'system', definitionSize: 'medium', customCss: '' },
  setCardHost,
  setWriteState,
  setPopupOptions,
  showNow,
  schedulePrefetch,
  dismissPopup,
}));

import { prefetchShirabeWordCard, toggleShirabeWordCard } from './shirabeWordCard.client';

beforeEach(() => vi.clearAllMocks());

describe('Shirabe card bridge', () => {
  test('warms a hovered token without changing the active card host', async () => {
    const element = document.createElement('span');
    const host = { lookup: vi.fn(), lookupEntry: vi.fn() } as never;
    await prefetchShirabeWordCard(element, host);
    expect(schedulePrefetch).toHaveBeenCalledWith(element, host);
    expect(setCardHost).not.toHaveBeenCalled();
  });

  test('passes theme, size, and a host footer through the SDK options', async () => {
    const element = document.createElement('span');
    const host = { lookup: vi.fn(), lookupEntry: vi.fn() } as never;
    const onClose = vi.fn();
    const shown = await toggleShirabeWordCard({
      element,
      host,
      definitionSize: 'large',
      languages: ['eng'],
      displayLocale: 'es',
      onClose,
    });

    expect(setCardHost).toHaveBeenCalledWith(host);
    expect(setWriteState).toHaveBeenCalledWith(expect.objectContaining({ displayLocale: 'es' }));
    expect(setPopupOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
        showAuthoring: false,
        definitionSize: 'large',
        footer: shown.actionsTarget,
        onClose,
      }),
    );
    expect(shown.actionsTarget?.className).toBe('nd-card-actions');
    expect(showNow).toHaveBeenCalledWith(element);
  });

  test('dismisses the open word without creating another footer', async () => {
    const element = document.createElement('span');
    element.classList.add('sb-word-open');
    const shown = await toggleShirabeWordCard({
      element,
      host: { lookup: vi.fn(), lookupEntry: vi.fn() } as never,
      definitionSize: 'medium',
      languages: ['eng'],
      displayLocale: 'en',
    });

    expect(shown).toEqual({ open: false, actionsTarget: null });
    expect(dismissPopup).toHaveBeenCalledOnce();
    expect(setPopupOptions).not.toHaveBeenCalled();
  });
});
