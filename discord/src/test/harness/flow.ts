import {
  createMockClient,
  createMockChatInputCommand,
  createMockButton,
  createMockModalSubmit,
  createMockStringSelectMenu,
  type MockClient,
  type MockCollector,
  type MockMessage,
} from '../mocks/interaction';
import { createCapture, extractStepResult, type ResponseCapture, type StepResult } from './types';

export class FlowRunner {
  private client: MockClient;
  private capture: ResponseCapture;
  private collector: MockCollector | null = null;
  private message: MockMessage | null = null;
  private userId: string;
  private guildId: string;

  constructor(opts: { userId?: string; guildId?: string } = {}) {
    this.client = createMockClient();
    this.capture = createCapture();
    this.userId = opts.userId ?? 'user-1';
    this.guildId = opts.guildId ?? 'guild-1';
  }

  async executeCommand(
    execute: (interaction: any) => Promise<void>,
    options?: Record<string, string | boolean | number | null>,
  ): Promise<StepResult> {
    const interaction = createMockChatInputCommand({
      commandName: 'search',
      options,
      userId: this.userId,
      guildId: this.guildId,
      client: this.client,
    });

    this.capture = interaction._capture;

    await execute(interaction);

    this.message = interaction._message;
    this.collector = interaction._message.collector;

    return extractStepResult(this.capture);
  }

  async clickButton(customId: string): Promise<StepResult> {
    if (!this.collector) throw new Error('No collector -- did you call executeCommand first?');

    const btnInteraction = createMockButton({
      customId,
      userId: this.userId,
      guildId: this.guildId,
      client: this.client,
      capture: this.capture,
    });

    await this.collector.simulateCollect(btnInteraction);

    return extractStepResult(this.capture);
  }

  async submitModal(fields: Record<string, string>): Promise<StepResult> {
    const showModalCall = this.capture.last('showModal');
    if (!showModalCall) throw new Error('No modal was shown -- did you click a button that shows a modal?');

    const modalData = showModalCall.args;
    const modalJson = typeof modalData.toJSON === 'function' ? modalData.toJSON() : modalData;
    const customId = modalJson.custom_id ?? modalJson.customId;

    const modalInteraction = createMockModalSubmit({
      customId,
      fields,
      userId: this.userId,
      guildId: this.guildId,
      client: this.client,
      capture: this.capture,
    });

    this.client.emit('interactionCreate', modalInteraction);

    // Modal handlers are async -- give them a tick to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    return extractStepResult(this.capture);
  }

  async selectMenu(customId: string, values: string[]): Promise<StepResult> {
    if (!this.collector) throw new Error('No collector');

    const selectInteraction = createMockStringSelectMenu({
      customId,
      values,
      userId: this.userId,
      guildId: this.guildId,
      client: this.client,
      capture: this.capture,
    });

    await this.collector.simulateCollect(selectInteraction);

    return extractStepResult(this.capture);
  }

  async end(): Promise<void> {
    this.collector?.stop();
  }

  getCapture(): ResponseCapture {
    return this.capture;
  }
}
