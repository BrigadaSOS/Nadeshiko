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

export function installProcessHandlers(processRef: ProcessLike = process) {
  processRef.on('uncaughtException', (error) => {
    writeFatal('Uncaught Exception', error);
  });

  processRef.on('unhandledRejection', (reason) => {
    writeFatal('Unhandled Rejection', reason);
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
