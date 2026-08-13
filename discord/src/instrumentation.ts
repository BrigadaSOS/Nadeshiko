import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { Interaction, MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';
import { recordInteraction, type Actor, type InteractionKind } from './analytics';
import { createLogger } from './logger';
import { getTracer } from './telemetry';

const log = createLogger('instrumentation');

/**
 * Every path a user can take through this bot passes through one of the four
 * wrappers below. That is the point of the file: before it, only slash commands
 * were traced, and slash commands are the smallest part of what people actually
 * do here. A search produces one `/search` and then a dozen button presses --
 * next page, context, filter, back -- each handled inside a message-component
 * collector that nothing wrapped. Thirty days of production telemetry recorded
 * one interaction total, which was not a usage problem, it was a measurement
 * problem.
 *
 * `traceComponent` is therefore the load-bearing one, and it is applied at the
 * collector rather than at each branch inside it: `collector.on('collect')` is
 * a single call site per command, while the branches it dispatches to number in
 * the dozens. The custom ID is on the interaction, so wrapping the collector
 * gets per-button granularity for free and cannot fall out of date when someone
 * adds a button.
 */

type Traced = {
  kind: InteractionKind;
  /** Bounded set: a command name or a custom ID, never user input. */
  name: string;
  /** The feature area, for grouping a command and its components together. */
  surface: string;
  actor: Actor;
  attributes?: Record<string, string>;
};

async function run(spec: Traced, fn: () => Promise<void>): Promise<void> {
  const { kind, name, surface, actor, attributes } = spec;
  const tracer = getTracer();

  const spanAttributes = {
    'discord.interaction.kind': kind,
    'discord.interaction.name': name,
    'discord.surface': surface,
    // Identifiers are fine on a SPAN -- traces are sampled, short-lived and
    // indexed differently. They are not fine as metric attributes, which is why
    // analytics.ts never receives them as such.
    'discord.user.id': actor.userId,
    'discord.guild.id': actor.guildId ?? 'dm',
    ...attributes,
  };

  return tracer.startActiveSpan(
    `${kind} ${name}`,
    { kind: SpanKind.SERVER, attributes: spanAttributes },
    async (span: Span) => {
      const start = performance.now();
      let failure: unknown;

      try {
        await fn();
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        failure = error;
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Unknown' });
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        recordInteraction({
          kind,
          name,
          surface,
          actor,
          durationSeconds: (performance.now() - start) / 1000,
          error: failure,
        });
        span.end();
      }
    },
  );
}

function actorOf(interaction: { user: { id: string }; guildId: string | null }): Actor {
  return { userId: interaction.user.id, guildId: interaction.guildId };
}

export async function traceCommand(
  commandName: string,
  interaction: Extract<Interaction, { commandName: string }>,
  fn: () => Promise<void>,
): Promise<void> {
  return run(
    {
      kind: 'command',
      name: commandName,
      surface: commandName,
      actor: actorOf(interaction),
      attributes: { 'discord.channel.id': interaction.channelId },
    },
    fn,
  );
}

/**
 * Wraps a `collector.on('collect')` handler.
 *
 * It swallows errors on purpose, and that is a change in behaviour worth being
 * explicit about: these handlers are async callbacks on an EventEmitter, so a
 * throw inside one was already never caught by anything -- it surfaced as an
 * unhandled rejection, killed nothing, told nobody, and left the user staring
 * at a button that did not respond. Now it is recorded as a failed interaction
 * and logged with its trace ID before being dropped, which is the same
 * user-visible outcome and a completely different debugging one.
 */
export function traceComponent(
  surface: string,
  handler: (interaction: MessageComponentInteraction) => Promise<void>,
): (interaction: MessageComponentInteraction) => Promise<void> {
  return async (interaction) => {
    try {
      await run(
        {
          kind: 'component',
          name: interaction.customId,
          surface,
          actor: actorOf(interaction),
          attributes: { 'discord.component.type': String(interaction.componentType) },
        },
        () => handler(interaction),
      );
    } catch (error) {
      log.error(
        { err: error, surface, customId: interaction.customId, traceId: getActiveTraceId() },
        'Component interaction failed',
      );
    }
  };
}

export function traceModal(
  surface: string,
  handler: (interaction: ModalSubmitInteraction) => Promise<void>,
): (interaction: ModalSubmitInteraction) => Promise<void> {
  return async (interaction) => {
    try {
      await run({ kind: 'modal', name: interaction.customId, surface, actor: actorOf(interaction) }, () =>
        handler(interaction),
      );
    } catch (error) {
      log.error(
        { err: error, surface, customId: interaction.customId, traceId: getActiveTraceId() },
        'Modal submission failed',
      );
    }
  };
}

/** Autocomplete and message events, which have no custom ID to name them by. */
export async function traceOperation(
  kind: InteractionKind,
  name: string,
  actor: Actor,
  fn: () => Promise<void>,
): Promise<void> {
  return run({ kind, name, surface: name, actor }, fn);
}

export function getActiveTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId;
}
