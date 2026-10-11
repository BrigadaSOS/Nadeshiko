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

/** Require telemetry lazily so boot loads dotenv first and remains importable by CLI scripts/tests without pulling
 * in the telemetry stack before handlers run. */
async function defaultRecorder(error: Error | string, errorType: string, extraAttrs?: Record<string, string>) {
  const { recordError } = await import('@lib/errorFingerprint');
  recordError(error, errorType, extraAttrs);
}

export function installProcessHandlers(processRef: ProcessLike = process, record: FatalRecorder = defaultRecorder) {
  /** Record fatal errors as fatal telemetry without changing the existing non-exiting process behavior; this makes
   * crashes queryable while keeping 5xx request-rate alerts separate. */
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
