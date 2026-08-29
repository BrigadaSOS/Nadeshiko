import { createCapture, type ResponseCapture } from '../harness/types';

/**
 * A registered test-double listener.
 *
 * `any[]` rather than `unknown[]` on purpose: handlers are registered with
 * their real, concrete parameter types and called back with loosely-typed
 * fixtures, which contravariant parameter checking would otherwise reject.
 */
type Listener = (...args: any[]) => unknown;

export type MockClient = {
  listeners: Map<string, Listener[]>;
  // `/health` reports the gateway latency and `/info` builds its install link
  // from the application id. Both are read straight off the client, so a client
  // double without them fails those commands at the first property access.
  ws: { ping: number };
  application: { id: string };
  on(event: string, handler: Listener): MockClient;
  off(event: string, handler: Listener): MockClient;
  emit(event: string, ...args: unknown[]): void;
};

export function createMockClient(opts: { wsPing?: number; applicationId?: string } = {}): MockClient {
  const listeners = new Map<string, Listener[]>();

  const client: MockClient = {
    listeners,
    ws: { ping: opts.wsPing ?? 42 },
    application: { id: opts.applicationId ?? 'app-1' },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return client;
    },
    off(event, handler) {
      const list = listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
      return client;
    },
    emit(event, ...args) {
      const list = listeners.get(event) ?? [];
      for (const fn of list) fn(...args);
    },
  };

  return client;
}

export type MockCollector = {
  handlers: Map<string, Listener[]>;
  on(event: string, handler: Listener): MockCollector;
  simulateCollect(interaction: unknown): Promise<void>;
  stop(reason?: string): void;
};

export type MockMessage = {
  collector: MockCollector | null;
  createMessageComponentCollector(opts?: { time?: number }): MockCollector;
  edit(data: unknown): Promise<MockMessage>;
};

function createMockCollector(): MockCollector {
  const handlers = new Map<string, Listener[]>();

  return {
    handlers,
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return this;
    },
    async simulateCollect(interaction) {
      const list = handlers.get('collect') ?? [];
      for (const fn of list) await fn(interaction);
    },
    stop(reason = 'user') {
      const list = handlers.get('end') ?? [];
      for (const fn of list) fn([], reason);
    },
  };
}

function createMockMessage(): MockMessage {
  const msg: MockMessage = {
    collector: null,
    createMessageComponentCollector() {
      const collector = createMockCollector();
      msg.collector = collector;
      return collector;
    },
    async edit() {
      return msg;
    },
  };
  return msg;
}

type MockInteractionOpts = {
  userId?: string;
  // Explicitly nullable: `null` is a real, meaningful value here (a DM or a
  // user-installed context), distinct from "the test did not care". Collapsing
  // the two with `??` made a DM impossible to simulate.
  guildId?: string | null;
  client: MockClient;
};

export function createMockChatInputCommand(
  opts: MockInteractionOpts & {
    commandName: string;
    options?: Record<string, string | boolean | number | null>;
  },
) {
  const capture = createCapture();
  const mockMessage = createMockMessage();
  const optionValues = opts.options ?? {};

  const interaction = {
    user: { id: opts.userId ?? 'user-1' },
    guildId: opts.guildId === undefined ? 'guild-1' : opts.guildId,
    channelId: 'channel-1',
    client: opts.client,
    replied: false,
    deferred: false,
    commandName: opts.commandName,

    // executeSearch serves both slash commands and buttons and asks which it
    // is, so the discriminator a real ChatInputCommandInteraction carries has
    // to be here too -- without it the call throws and every flow test reports
    // the generic "Something went wrong." instead of the real failure.
    isButton: () => false,

    options: {
      getString(name: string) {
        const val = optionValues[name];
        return typeof val === 'string' ? val : null;
      },
      getBoolean(name: string) {
        const val = optionValues[name];
        return typeof val === 'boolean' ? val : null;
      },
      getInteger(name: string) {
        const val = optionValues[name];
        return typeof val === 'number' ? val : null;
      },
    },

    async deferReply() {
      interaction.deferred = true;
      capture.calls.push({ method: 'deferReply', args: undefined });
    },

    async editReply(data: any) {
      interaction.replied = true;
      capture.calls.push({ method: 'editReply', args: data });
      return mockMessage;
    },

    async reply(data: any) {
      interaction.replied = true;
      capture.calls.push({ method: 'reply', args: data });
      return mockMessage;
    },

    async followUp(data: any) {
      capture.calls.push({ method: 'followUp', args: data });
    },

    async fetchReply() {
      return mockMessage;
    },

    _capture: capture,
    _message: mockMessage,
  };

  return interaction;
}

export function createMockButton(
  opts: MockInteractionOpts & {
    customId: string;
    capture: ResponseCapture;
    message?: MockMessage;
  },
) {
  const ownCapture = createCapture();

  const interaction = {
    user: { id: opts.userId ?? 'user-1' },
    guildId: opts.guildId === undefined ? 'guild-1' : opts.guildId,
    channelId: 'channel-1',
    client: opts.client,
    customId: opts.customId,
    replied: false,
    deferred: false,

    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,

    async update(data: any) {
      interaction.replied = true;
      opts.capture.calls.push({ method: 'update', args: data });
    },

    async deferUpdate() {
      interaction.deferred = true;
      opts.capture.calls.push({ method: 'deferUpdate', args: undefined });
    },

    async editReply(data: any) {
      interaction.replied = true;
      opts.capture.calls.push({ method: 'editReply', args: data });
    },

    async followUp(data: any) {
      opts.capture.calls.push({ method: 'followUp', args: data });
    },

    async showModal(modal: any) {
      ownCapture.calls.push({ method: 'showModal', args: modal });
      opts.capture.calls.push({ method: 'showModal', args: modal });
    },

    _capture: ownCapture,
  };

  return interaction;
}

export function createMockModalSubmit(
  opts: MockInteractionOpts & {
    customId: string;
    fields: Record<string, string>;
    capture: ResponseCapture;
  },
) {
  const interaction = {
    user: { id: opts.userId ?? 'user-1' },
    guildId: opts.guildId === undefined ? 'guild-1' : opts.guildId,
    channelId: 'channel-1',
    client: opts.client,
    customId: opts.customId,
    replied: false,
    deferred: false,

    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,

    fields: {
      getTextInputValue(fieldId: string) {
        return opts.fields[fieldId] ?? '';
      },
    },

    async deferUpdate() {
      interaction.deferred = true;
      opts.capture.calls.push({ method: 'deferUpdate', args: undefined });
    },

    async editReply(data: any) {
      interaction.replied = true;
      opts.capture.calls.push({ method: 'editReply', args: data });
    },

    async followUp(data: any) {
      opts.capture.calls.push({ method: 'followUp', args: data });
    },
  };

  return interaction;
}

export function createMockStringSelectMenu(
  opts: MockInteractionOpts & {
    customId: string;
    values: string[];
    capture: ResponseCapture;
  },
) {
  const interaction = {
    user: { id: opts.userId ?? 'user-1' },
    guildId: opts.guildId === undefined ? 'guild-1' : opts.guildId,
    channelId: 'channel-1',
    client: opts.client,
    customId: opts.customId,
    values: opts.values,
    replied: false,
    deferred: false,

    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,

    async update(data: any) {
      interaction.replied = true;
      opts.capture.calls.push({ method: 'update', args: data });
    },

    async deferUpdate() {
      interaction.deferred = true;
      opts.capture.calls.push({ method: 'deferUpdate', args: undefined });
    },

    async editReply(data: any) {
      interaction.replied = true;
      opts.capture.calls.push({ method: 'editReply', args: data });
    },

    async followUp(data: any) {
      opts.capture.calls.push({ method: 'followUp', args: data });
    },
  };

  return interaction;
}
