import { createCapture, type ResponseCapture } from '../harness/types';

export type MockClient = {
  listeners: Map<string, Function[]>;
  on(event: string, handler: Function): MockClient;
  off(event: string, handler: Function): MockClient;
  emit(event: string, ...args: unknown[]): void;
};

export function createMockClient(): MockClient {
  const listeners = new Map<string, Function[]>();

  const client: MockClient = {
    listeners,
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
  handlers: Map<string, Function[]>;
  on(event: string, handler: Function): MockCollector;
  simulateCollect(interaction: unknown): Promise<void>;
  stop(reason?: string): void;
};

export type MockMessage = {
  collector: MockCollector | null;
  createMessageComponentCollector(opts?: { time?: number }): MockCollector;
  edit(data: unknown): Promise<MockMessage>;
};

function createMockCollector(): MockCollector {
  const handlers = new Map<string, Function[]>();

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
  guildId?: string;
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
    guildId: opts.guildId ?? 'guild-1',
    channelId: 'channel-1',
    client: opts.client,
    replied: false,
    deferred: false,
    commandName: opts.commandName,

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
    guildId: opts.guildId ?? 'guild-1',
    channelId: 'channel-1',
    client: opts.client,
    customId: opts.customId,
    replied: false,
    deferred: false,

    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,

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
    guildId: opts.guildId ?? 'guild-1',
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
    guildId: opts.guildId ?? 'guild-1',
    channelId: 'channel-1',
    client: opts.client,
    customId: opts.customId,
    values: opts.values,
    replied: false,
    deferred: false,

    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,

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
