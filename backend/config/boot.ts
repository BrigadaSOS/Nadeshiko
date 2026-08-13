import dotenv from 'dotenv';

const BOOT_INITIALIZED = Symbol.for('nadeshiko.config.boot.initialized');

type GlobalWithBoot = typeof globalThis & {
  [BOOT_INITIALIZED]?: boolean;
};

type StderrWriter = (message: string) => void;

export function writeFatal(
  prefix: string,
  payload: unknown,
  write: StderrWriter = process.stderr.write.bind(process.stderr),
) {
  const body =
    payload instanceof Error
      ? payload.stack || payload.message
      : typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);

  write(`[boot] ${prefix}: ${body}\n`);
}

type ProcessLike = Pick<typeof process, 'on'>;

type FatalRecorder = (error: Error | string, errorType: string, extraAttrs?: Record<string, string>) => unknown;

/**
 * Lazily required so `boot` keeps its one job -- load `.env` before anything
 * reads `process.env` -- and stays importable by `bin/*` scripts and tests
 * without dragging the telemetry stack in behind it. By the time a handler
 * below actually fires, everything is long since loaded.
 */
async function defaultRecorder(error: Error | string, errorType: string, extraAttrs?: Record<string, string>) {
  const { recordError } = await import('@lib/errorFingerprint');
  recordError(error, errorType, extraAttrs);
}

export function installProcessHandlers(processRef: ProcessLike = process, record: FatalRecorder = defaultRecorder) {
  /**
   * A fatal used to write one raw line to stderr and nothing else -- no
   * counter, no span. `app.exception` is the metric every *handled* error feeds
   * and the one the 5xx alerts read, so the single class of failure that takes
   * the whole process down was the one class invisible to it: the counter would
   * be flat across a crash, and the only evidence was an unstructured line with
   * no fingerprint to group by.
   *
   * `error.severity: fatal` keeps these out of the 5xx rate rules -- which
   * measure request outcomes, and a dead process serves no requests to be wrong
   * about -- while making "did anything die" a query rather than a log grep.
   *
   * Note what this deliberately does NOT do: exit. The handlers have never
   * exited, the process is left running on undefined state, and changing that
   * is a real decision about restart behaviour rather than an instrumentation
   * one. It is now at least a decision that shows up on a dashboard.
   */
  const report = (prefix: string, errorType: string, payload: unknown) => {
    writeFatal(prefix, payload);
    try {
      const error = payload instanceof Error ? payload : String(payload);
      void Promise.resolve(record(error, errorType, { 'error.severity': 'fatal' })).catch(() => {});
    } catch {
      // Recording a fatal must never be the thing that throws inside a fatal
      // handler: stderr already has the original, which is what matters.
    }
  };

  processRef.on('uncaughtException', (error) => {
    report('Uncaught Exception', 'UncaughtException', error);
  });

  processRef.on('unhandledRejection', (reason) => {
    report('Unhandled Rejection', 'UnhandledRejection', reason);
  });
}

interface InitializeBootDependencies {
  configureEnv?: () => unknown;
  installHandlers?: () => void;
  globalObject?: GlobalWithBoot;
}

export function initializeBoot(dependencies: InitializeBootDependencies = {}) {
  const globalBoot = dependencies.globalObject || (globalThis as GlobalWithBoot);
  if (globalBoot[BOOT_INITIALIZED]) {
    return;
  }

  const configureEnv = dependencies.configureEnv || (() => dotenv.config({ quiet: true }));
  const installHandlers = dependencies.installHandlers || (() => installProcessHandlers());

  configureEnv();
  installHandlers();

  globalBoot[BOOT_INITIALIZED] = true;
}

initializeBoot();
