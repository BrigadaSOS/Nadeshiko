import { describe, expect, it, vi } from 'bun:test';
import { initializeBoot, installProcessHandlers, writeFatal } from '@config/boot';

describe('writeFatal', () => {
  it('writes formatted message for Error payloads', () => {
    const write = vi.fn();
    writeFatal('Uncaught Exception', new Error('boom'), write);

    const output = write.mock.calls[0]?.[0] as string;
    expect(output.startsWith('[boot] Uncaught Exception:')).toBe(true);
    expect(output.includes('boom')).toBe(true);
  });

  it('writes formatted message for string payloads', () => {
    const write = vi.fn();
    writeFatal('Unhandled Rejection', 'plain-message', write);

    expect(write).toHaveBeenCalledWith('[boot] Unhandled Rejection: plain-message\n');
  });

  it('writes formatted message for object payloads', () => {
    const write = vi.fn();
    writeFatal('Unhandled Rejection', { code: 'E_FAIL' }, write);

    expect(write).toHaveBeenCalledWith('[boot] Unhandled Rejection: {"code":"E_FAIL"}\n');
  });
});

describe('installProcessHandlers', () => {
  it('registers handlers for uncaughtException and unhandledRejection', () => {
    const on = vi.fn();
    installProcessHandlers({ on } as any);

    expect(on).toHaveBeenCalledTimes(2);
    expect(on.mock.calls[0]?.[0]).toBe('uncaughtException');
    expect(on.mock.calls[1]?.[0]).toBe('unhandledRejection');
    expect(typeof on.mock.calls[0]?.[1]).toBe('function');
    expect(typeof on.mock.calls[1]?.[1]).toBe('function');
  });
});

describe('initializeBoot', () => {
  it('runs dotenv and process handler installation only once', () => {
    const configureEnv = vi.fn();
    const installHandlers = vi.fn();
    const globalObject = {} as any;

    initializeBoot({ configureEnv, installHandlers, globalObject });
    initializeBoot({ configureEnv, installHandlers, globalObject });

    expect(configureEnv).toHaveBeenCalledTimes(1);
    expect(installHandlers).toHaveBeenCalledTimes(1);
  });
});
