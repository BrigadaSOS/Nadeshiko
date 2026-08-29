import { describe, test, expect, beforeEach, vi } from 'vitest';

/**
 * `/settings` is the only surface that writes durable state, and the thing that
 * makes it worth a flow test rather than a unit test is that the write happens
 * inside a component collector: the select menu, the persistence call, and the
 * re-render are three separate steps, and a break in the middle one leaves the
 * UI showing the value the user picked while the database still holds the old
 * one. Only driving the whole interaction catches that.
 *
 * Settings are backed by an in-memory store rather than the shared `settings`
 * mock, because "did it persist" is the assertion.
 */
const store = new Map<string, { language: string }>();

vi.mock('../../settings', () => ({
  initSettings: () => {},
  getGuildSettings: (guildId: string | null) =>
    guildId ? (store.get(guildId) ?? { language: 'both' }) : { language: 'both' },
  setGuildSetting: (guildId: string, key: string, value: string) => {
    store.set(guildId, { ...(store.get(guildId) ?? { language: 'both' }), [key]: value });
  },
  resetGuildSettings: (guildId: string) => {
    store.delete(guildId);
  },
}));

vi.mock('../../instrumentation', () => ({
  traceComponent: (_surface: string, handler: (i: unknown) => Promise<void>) => handler,
  getActiveTraceId: () => undefined,
}));

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../../config', () => ({
  BOT_CONFIG: { embedColor: 0x8b5cf6 },
}));

import { execute } from '../../commands/settings';
import { FlowRunner } from '../harness/flow';

beforeEach(() => {
  store.clear();
});

/** Options offered by a select menu in the last rendered step. */
function optionValues(result: { selectMenus: { customId: string; options: { value: string }[] }[] }, customId: string) {
  return result.selectMenus.find((m) => m.customId === customId)?.options.map((o) => o.value);
}

describe('/settings', () => {
  test('opens on the settings menu', async () => {
    const flow = new FlowRunner();

    const result = await flow.executeCommand(execute, {}, 'settings');

    expect(optionValues(result, 'settings_pick')).toEqual(['language', 'reset']);
  });

  test('shows the current language, so the user can see what they are changing', async () => {
    store.set('guild-1', { language: 'es' });
    const flow = new FlowRunner();

    const result = await flow.executeCommand(execute, {}, 'settings');

    expect(result.embeds[0].fields[0].value).toContain('Spanish');
  });

  test('picking Language opens the language picker with every option', async () => {
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');

    const result = await flow.selectMenu('settings_pick', ['language']);

    expect(optionValues(result, 'settings_language')).toEqual(['en', 'es', 'both', 'none']);
  });

  test('the picker pre-selects the language already in force', async () => {
    // Without `default`, the menu opens showing a placeholder and a user who
    // wanted to check their setting cannot tell what it is.
    store.set('guild-1', { language: 'none' });
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');

    await flow.selectMenu('settings_pick', ['language']);
    const menu = flow.getCapture().lastOfArgs(['update', 'reply']).components[0].toJSON().components[0];

    expect(menu.options.find((o: { value: string; default?: boolean }) => o.default)?.value).toBe('none');
  });

  test.each(['en', 'es', 'both', 'none'])('choosing %s persists it for the guild', async (language) => {
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');
    await flow.selectMenu('settings_pick', ['language']);

    await flow.selectMenu('settings_language', [language]);

    expect(store.get('guild-1')).toEqual({ language });
  });

  test('after choosing, the view returns to the settings menu showing the new value', async () => {
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');
    await flow.selectMenu('settings_pick', ['language']);

    const result = await flow.selectMenu('settings_language', ['en']);

    expect(optionValues(result, 'settings_pick')).toEqual(['language', 'reset']);
    expect(result.embeds[0].fields[0].value).toContain('English');
  });

  test('Back returns to the settings menu without changing anything', async () => {
    store.set('guild-1', { language: 'es' });
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');
    await flow.selectMenu('settings_pick', ['language']);

    const result = await flow.clickButton('settings_back');

    expect(optionValues(result, 'settings_pick')).toEqual(['language', 'reset']);
    expect(store.get('guild-1')).toEqual({ language: 'es' });
  });

  test('Reset clears the guild’s stored settings', async () => {
    store.set('guild-1', { language: 'none' });
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');

    const result = await flow.selectMenu('settings_pick', ['reset']);

    expect(store.has('guild-1')).toBe(false);
    expect(result.embeds[0].fields[0].value).toContain('Both');
  });

  test('an unknown select value is ignored rather than crashing the collector', async () => {
    // Discord will replay a custom_id from an older message version after a
    // deploy. Throwing here kills the collector for the whole message.
    const flow = new FlowRunner();
    await flow.executeCommand(execute, {}, 'settings');

    await expect(flow.selectMenu('settings_pick', ['not-a-setting'])).resolves.toBeDefined();
  });
});

describe('/settings outside a server', () => {
  test('refuses in a DM instead of writing settings under a null guild', async () => {
    // The command is server-scoped, but a user install can invoke it in a DM.
    // Guild settings keyed on `null` would leak one user's choice to everyone.
    const flow = new FlowRunner({ guildId: null });

    const result = await flow.executeCommand(execute, {}, 'settings');

    expect(result.content).toBe('This command can only be used in a server.');
    expect(store.size).toBe(0);
  });
});
