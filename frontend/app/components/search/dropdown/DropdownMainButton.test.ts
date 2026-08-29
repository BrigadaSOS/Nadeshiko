// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';

/**
 * The trigger half of a dropdown.
 *
 * Its classes resolve through a precedence rather than a merge: an explicit
 * class REPLACES the default outright, and the two shorthands below it are
 * mutually exclusive variations on that default. Merging them instead would put
 * two conflicting borders on one button and let stylesheet order pick.
 *
 * The rest is the accessible pairing with the menu: the button announces whether
 * the menu is open, and its `aria-controls`/labelling id has to be the id the
 * CONTAINER resolved -- not one this button invents -- or the two halves of the
 * same control describe themselves as different things.
 */
import { DROPDOWN_INJECTION_KEY } from '~/composables/useDropdownState';

import DropdownMainButton from './DropdownMainButton.vue';

const mounted: { unmount: () => void }[] = [];

const isOpen = ref(false);
const toggle = vi.fn(() => {
  isOpen.value = !isOpen.value;
});

/** Mounts the trigger inside a container that provides the dropdown context. */
function render(props: Record<string, unknown> = {}, providedId: unknown = undefined) {
  const wrapper = mount(DropdownMainButton, {
    props,
    global: {
      provide: {
        [DROPDOWN_INJECTION_KEY as unknown as symbol]: {
          id: computed(() => 'resolved-id'),
          isOpen: computed(() => isOpen.value),
          toggle,
          close: vi.fn(),
        },
        ...(providedId === undefined ? {} : { ndDropdownResolvedId: providedId }),
      },
      stubs: { UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const button = (w: ReturnType<typeof render>) => w.get('button');

beforeEach(() => {
  vi.clearAllMocks();
  isOpen.value = false;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which classes it wears', () => {
  test('the default when nothing is asked for', () => {
    const cls = button(render()).attributes('class') ?? '';

    expect(cls).toContain('border-hairline');
  });

  test('an explicit class REPLACES the default rather than adding to it', () => {
    // Merging would leave two conflicting borders and let stylesheet order pick.
    const cls = button(render({ dropdownButtonClass: 'my-own-class' })).attributes('class') ?? '';

    expect(cls).toBe('my-own-class');
  });

  test('borderless drops the border and keeps the rest', () => {
    const cls = button(render({ borderless: true })).attributes('class') ?? '';

    expect(cls).not.toContain('border-hairline');
    expect(cls).toContain('rounded-lg');
  });

  test('the segment-hover variant reveals its outline on hover instead', () => {
    const cls = button(render({ segmentHoverBorder: true })).attributes('class') ?? '';

    expect(cls).toContain('group-hover:border-hairline');
    expect(cls).toContain('border-transparent');
  });

  test('and an explicit class still beats the shorthands', () => {
    const cls =
      button(render({ dropdownButtonClass: 'mine', segmentHoverBorder: true, borderless: true })).attributes('class') ??
      '';

    expect(cls).toBe('mine');
  });
});

describe('what it tells a screen reader', () => {
  test('that it opens a menu', () => {
    expect(button(render()).attributes('aria-haspopup')).toBe('menu');
  });

  test('and whether that menu is open', async () => {
    const wrapper = render();
    expect(button(wrapper).attributes('aria-expanded')).toBe('false');

    isOpen.value = true;
    await nextTick();

    expect(button(wrapper).attributes('aria-expanded')).toBe('true');
  });
});

describe('the id it pairs with the menu', () => {
  test('uses the id the CONTAINER resolved', async () => {
    // Both halves of one control must name the same thing.
    const wrapper = render(
      {},
      computed(() => 'container-id'),
    );

    expect(button(wrapper).attributes('id')).toBe('container-id');
  });

  test('accepts a plain string too', () => {
    expect(button(render({}, 'plain-id')).attributes('id')).toBe('plain-id');
  });

  test('and falls back to a unique one when standing alone', () => {
    // Two triggers with no container must not claim the same id.
    const Parent = defineComponent({
      components: { DropdownMainButton },
      template: '<div><DropdownMainButton /><DropdownMainButton /></div>',
    });
    const wrapper = mount(Parent, {
      global: {
        provide: {
          [DROPDOWN_INJECTION_KEY as unknown as symbol]: {
            id: computed(() => 'x'),
            isOpen: computed(() => false),
            toggle,
            close: vi.fn(),
          },
        },
        stubs: { UiBaseIcon: true },
      },
    });
    mounted.push(wrapper);

    const ids = wrapper.findAll('button').map((b) => b.attributes('id'));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('pressing it', () => {
  test('asks the container to toggle', async () => {
    const wrapper = render();

    await button(wrapper).trigger('click');

    expect(toggle).toHaveBeenCalled();
  });
});

describe('the chevron', () => {
  test('is shown by default', () => {
    expect(render().findAll('*').length).toBeGreaterThan(1);
  });

  test('and omitted for an icon-only trigger', () => {
    // A row's ⋮ menu has no labelled chevron to turn.
    const withChevron = render().html();
    const without = render({ showChevron: false }).html();

    expect(without.length).toBeLessThan(withChevron.length);
  });
});
