type OverlayTarget = string | HTMLElement | null | undefined;

type OverlayController = {
  open: (target: OverlayTarget) => void;
  close: (target: OverlayTarget) => void;
  getInstance: (target: OverlayTarget) => { element: HTMLElement } | null;
};

declare global {
  interface Window {
    NDOverlay?: OverlayController;
  }
}

const DROPDOWN_OPEN_CLASS = 'nd-dropdown-open';
const OVERLAY_OPEN_CLASS = 'nd-overlay-open';
const OVERLAY_BACKDROP_SUFFIX = '-backdrop';

function resolveTarget(target: OverlayTarget): HTMLElement | null {
  if (!target) return null;
  if (target instanceof HTMLElement) return target;
  return document.querySelector<HTMLElement>(target);
}

function applyPrefixedStateClasses(root: HTMLElement, prefix: string, enabled: boolean) {
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('[class]'))];

  for (const node of nodes) {
    const stateClasses = Array.from(node.classList).filter((klass) => klass.startsWith(`${prefix}:`));

    for (const klass of stateClasses) {
      const runtimeClass = klass.slice(prefix.length + 1);
      if (!runtimeClass) continue;

      if (enabled) {
        node.classList.add(runtimeClass);
      } else {
        node.classList.remove(runtimeClass);
      }
    }
  }
}

function hasOpenOverlays() {
  return document.querySelector('.nd-overlay:not(.hidden)') !== null;
}

function createBackdrop(overlay: HTMLElement) {
  const overlayId = overlay.id || `nd-overlay-${Math.random().toString(36).slice(2)}`;
  if (!overlay.id) overlay.id = overlayId;

  const backdropId = `${overlayId}${OVERLAY_BACKDROP_SUFFIX}`;
  if (document.getElementById(backdropId)) return;

  const backdrop = document.createElement('div');
  backdrop.id = backdropId;
  backdrop.className = 'fixed inset-0 bg-gray-900/50';

  const overlayZIndex = Number.parseInt(window.getComputedStyle(overlay).zIndex || '60', 10);
  backdrop.style.zIndex = String(Number.isFinite(overlayZIndex) ? Math.max(overlayZIndex - 1, 1) : 59);

  backdrop.addEventListener('click', () => {
    closeOverlay(overlay);
  });

  document.body.appendChild(backdrop);
}

function removeBackdrop(overlay: HTMLElement) {
  if (!overlay.id) return;
  const backdrop = document.getElementById(`${overlay.id}${OVERLAY_BACKDROP_SUFFIX}`);
  backdrop?.remove();
}

function openOverlay(target: OverlayTarget) {
  const overlay = resolveTarget(target);
  if (!overlay) return;

  if (!overlay.classList.contains('hidden')) return;

  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-overlay', 'true');
  overlay.setAttribute('tabindex', '-1');
  createBackdrop(overlay);

  if (overlay.classList.contains('translate-x-full')) {
    overlay.dataset.ndRestoreTranslateX = '1';
    overlay.classList.remove('translate-x-full');
    overlay.classList.add('translate-x-0');
  }

  document.body.style.overflow = 'hidden';

  // Add the open class on the next frame so the browser renders the initial
  // state (opacity-0) first, allowing the CSS transition to animate.
  requestAnimationFrame(() => {
    overlay.classList.add(OVERLAY_OPEN_CLASS, 'open', 'opened');
  });
}

function closeOverlay(target: OverlayTarget) {
  const overlay = resolveTarget(target);
  if (!overlay) return;
  if (overlay.classList.contains('hidden')) return;

  applyPrefixedStateClasses(overlay, OVERLAY_OPEN_CLASS, false);

  overlay.classList.remove(OVERLAY_OPEN_CLASS, 'open', 'opened', 'translate-x-0');
  overlay.classList.add('hidden');
  overlay.removeAttribute('aria-overlay');
  overlay.removeAttribute('tabindex');

  if (overlay.dataset.ndRestoreTranslateX === '1') {
    overlay.classList.add('translate-x-full');
    delete overlay.dataset.ndRestoreTranslateX;
  }

  removeBackdrop(overlay);

  if (!hasOpenOverlays()) {
    document.body.style.overflow = '';
  }
}

function closeAllDropdowns() {
  for (const dropdown of document.querySelectorAll<HTMLElement>(`.${DROPDOWN_OPEN_CLASS}`)) {
    closeDropdown(dropdown);
  }
}

function openDropdown(dropdown: HTMLElement) {
  closeAllDropdowns();

  dropdown.classList.add(DROPDOWN_OPEN_CLASS);
  applyPrefixedStateClasses(dropdown, DROPDOWN_OPEN_CLASS, true);
}

function closeDropdown(dropdown: HTMLElement) {
  dropdown.classList.remove(DROPDOWN_OPEN_CLASS);
  applyPrefixedStateClasses(dropdown, DROPDOWN_OPEN_CLASS, false);
}

function toggleDropdown(dropdown: HTMLElement) {
  if (dropdown.classList.contains(DROPDOWN_OPEN_CLASS)) {
    closeDropdown(dropdown);
    return;
  }

  openDropdown(dropdown);
}

function toggleCollapse(trigger: HTMLElement) {
  const selector = trigger.getAttribute('data-nd-collapse');
  if (!selector) return;

  const target = resolveTarget(selector);
  if (!target) return;

  const isOpen = !target.classList.contains('hidden');

  target.classList.toggle('hidden', isOpen);
  trigger.setAttribute('aria-expanded', String(!isOpen));
  applyPrefixedStateClasses(trigger, 'nd-collapse-open', !isOpen);
}

export default defineNuxtPlugin((nuxtApp) => {
  window.NDOverlay = {
    open: openOverlay,
    close: closeOverlay,
    getInstance: (target: OverlayTarget) => {
      const element = resolveTarget(target);
      return element ? { element } : null;
    },
  };

  const clickHandler = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const overlayTrigger = target.closest<HTMLElement>('[data-nd-overlay]');
    if (overlayTrigger) {
      event.preventDefault();
      const selector = overlayTrigger.getAttribute('data-nd-overlay');
      const overlay = resolveTarget(selector);
      if (!overlay) return;

      if (overlay.classList.contains('hidden')) {
        openOverlay(overlay);
      } else {
        closeOverlay(overlay);
      }

      closeAllDropdowns();
      return;
    }

    const collapseTrigger = target.closest<HTMLElement>('[data-nd-collapse]');
    if (collapseTrigger) {
      event.preventDefault();
      toggleCollapse(collapseTrigger);
      return;
    }

    const dropdownToggle = target.closest<HTMLElement>('.nd-dropdown-toggle');
    if (dropdownToggle) {
      const dropdown = dropdownToggle.closest<HTMLElement>('.nd-dropdown');
      if (!dropdown) return;

      event.preventDefault();
      toggleDropdown(dropdown);
      return;
    }

    const backdrop = target.closest<HTMLElement>('.nd-overlay');
    if (backdrop && backdrop === target && !backdrop.classList.contains('hidden')) {
      closeOverlay(backdrop);
      return;
    }

    const dropdownItem = target.closest('.nd-dropdown-menu a, .nd-dropdown-menu button');
    if (dropdownItem) {
      const dropdown = target.closest<HTMLElement>('.nd-dropdown');
      if (dropdown) closeDropdown(dropdown);
      return;
    }

    if (!target.closest('.nd-dropdown')) {
      closeAllDropdowns();
    }
  };

  const keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeAllDropdowns();

      const openOverlays = Array.from(document.querySelectorAll<HTMLElement>('.nd-overlay:not(.hidden)'));
      const topMostOverlay = openOverlays.at(-1);
      if (topMostOverlay) closeOverlay(topMostOverlay);
    }
  };

  document.addEventListener('click', clickHandler);
  document.addEventListener('keydown', keydownHandler);

  nuxtApp.hook('page:finish', () => {
    closeAllDropdowns();
  });
});
