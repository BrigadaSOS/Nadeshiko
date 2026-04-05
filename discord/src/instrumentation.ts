import { SpanKind, SpanStatusCode, type Histogram, type Counter } from '@opentelemetry/api';
import { getTracer, getMeter } from './telemetry';
import { Sentry } from './sentry';
import type { ChatInputCommandInteraction } from 'discord.js';

let commandDuration: Histogram | undefined;
let commandErrors: Counter | undefined;
let apiCallDuration: Histogram | undefined;

export function initInstrumentation() {
  const meter = getMeter();
  if (!meter) return;

  commandDuration = meter.createHistogram('discord.command.duration', {
    description: 'Duration of Discord command execution in seconds',
    unit: 's',
  });

  commandErrors = meter.createCounter('discord.command.errors', {
    description: 'Number of Discord command errors',
  });

  apiCallDuration = meter.createHistogram('discord.api_call.duration', {
    description: 'Duration of Nadeshiko API calls in seconds',
    unit: 's',
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

  if (!tracer) {
    return fn();
  }

  return tracer.startActiveSpan(`command ${commandName}`, { kind: SpanKind.SERVER, attributes }, async (span) => {
    const start = performance.now();
    try {
      await fn();
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown' });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      commandErrors?.add(1, { command: commandName });
      Sentry.captureException(error, { tags: { command: commandName }, extra: attributes });
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      commandDuration?.record(durationS, { command: commandName });
      span.end();
    }
  });
}

export async function traceApiCall<T>(operation: string, path: string, fn: () => Promise<T>): Promise<T> {
  const tracer = getTracer();

  const attributes = {
    'http.method': operation,
    'http.url': path,
  };

  if (!tracer) {
    return fn();
  }

  return tracer.startActiveSpan(`api ${operation} ${path}`, { kind: SpanKind.CLIENT, attributes }, async (span) => {
    const start = performance.now();
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown' });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      const durationS = (performance.now() - start) / 1000;
      apiCallDuration?.record(durationS, { operation, path });
      span.end();
    }
  });
}
