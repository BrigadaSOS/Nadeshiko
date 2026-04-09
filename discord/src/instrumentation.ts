import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { getTracer, getMeter } from './telemetry';
import type { ChatInputCommandInteraction } from 'discord.js';

const meter = getMeter();

const commandDuration = meter.createHistogram('discord.command.duration', {
  description: 'Duration of Discord command execution in seconds',
  unit: 's',
});

const commandErrors = meter.createCounter('discord.command.errors', {
  description: 'Number of Discord command errors',
});

export async function traceOperation(
  operationName: string,
  attributes: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const tracer = getTracer();

  return tracer.startActiveSpan(operationName, { kind: SpanKind.SERVER, attributes }, async (span) => {
    const start = performance.now();
    try {
      await fn();
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown' });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      commandErrors.add(1, { command: operationName });
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      commandDuration.record(durationS, { command: operationName });
      span.end();
    }
  });
}

export async function traceCommand(
  commandName: string,
  interaction: ChatInputCommandInteraction,
  fn: () => Promise<void>,
): Promise<void> {
  const tracer = getTracer();

  const attributes = {
    'discord.command': commandName,
    'discord.user.id': interaction.user.id,
    'discord.guild.id': interaction.guildId ?? 'dm',
    'discord.channel.id': interaction.channelId,
  };

  return tracer.startActiveSpan(`command ${commandName}`, { kind: SpanKind.SERVER, attributes }, async (span) => {
    const start = performance.now();
    try {
      await fn();
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown' });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      commandErrors.add(1, { command: commandName });
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      commandDuration.record(durationS, { command: commandName });
      span.end();
    }
  });
}

export function getActiveTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}
