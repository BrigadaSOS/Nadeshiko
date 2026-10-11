import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Vary frozen module-load config through a Proxy over an unfrozen copy; overriding a frozen key directly would
 * throw, while fall-through keeps the rest of the import chain usable. */
const overrides: Record<string, unknown> = {};

vi.mock('@config/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/config')>();

  return {
    ...actual,
    config: new Proxy(
      { ...actual.config },
      { get: (target, key) => (key in overrides ? overrides[key as string] : target[key as keyof typeof target]) },
    ),
  };
});

const configValues = {
  set LIFECYCLE_EMAILS_ENABLED(value: boolean) {
    overrides.LIFECYCLE_EMAILS_ENABLED = value;
  },
  set LIFECYCLE_EMAILS_ONLY_TO(value: string | undefined) {
    overrides.LIFECYCLE_EMAILS_ONLY_TO = value;
  },
};

const { lifecycleSendsAreLive, mayReallySend, describeLifecycleGate } = await import(
  '@app/services/email/lifecycleGate'
);

beforeEach(() => {
  configValues.LIFECYCLE_EMAILS_ENABLED = false;
  configValues.LIFECYCLE_EMAILS_ONLY_TO = undefined;
});

describe('with the switch off', () => {
  /** Preserve the disabled-send gate so an unconfigured environment does not mail readers. */
  it('sends to nobody', () => {
    expect(lifecycleSendsAreLive()).toBe(false);
    expect(mayReallySend('anyone@example.com')).toBe(false);
  });

  it('ignores an allowlist, so a leftover value cannot turn sending back on', () => {
    configValues.LIFECYCLE_EMAILS_ONLY_TO = 'dav@nadeshiko.co';

    expect(mayReallySend('dav@nadeshiko.co')).toBe(false);
  });

  it('says so plainly, since this line is how anybody finds out', () => {
    expect(describeLifecycleGate()).toContain('DRY RUN');
    expect(describeLifecycleGate()).toContain('LIFECYCLE_EMAILS_ENABLED=true');
  });
});

describe('with the switch on and no allowlist', () => {
  beforeEach(() => {
    configValues.LIFECYCLE_EMAILS_ENABLED = true;
  });

  it('sends to everybody', () => {
    expect(mayReallySend('anyone@example.com')).toBe(true);
    expect(describeLifecycleGate()).toContain('every recipient');
  });
});

describe('with the switch on and an allowlist', () => {
  beforeEach(() => {
    configValues.LIFECYCLE_EMAILS_ENABLED = true;
    configValues.LIFECYCLE_EMAILS_ONLY_TO = 'dav@nadeshiko.co, Natsume@Nadeshiko.co';
  });

  it('sends to a listed address', () => {
    expect(mayReallySend('dav@nadeshiko.co')).toBe(true);
  });

  /** Normalize addresses before comparison; a case-sensitive allowlist would silently miss an address typed in
   * another case. */
  it('matches regardless of case or surrounding space', () => {
    expect(mayReallySend('NATSUME@nadeshiko.co')).toBe(true);
    expect(mayReallySend('  dav@nadeshiko.co  ')).toBe(true);
  });

  it('does not send to anybody else', () => {
    expect(mayReallySend('stranger@example.com')).toBe(false);
  });

  it('reports how many addresses are live', () => {
    expect(describeLifecycleGate()).toContain('2 allowlisted');
  });

  /** An allowlist that parses to no addresses must fail closed as “nobody,” not open as “everybody.” */
  it('treats an allowlist of separators as empty, not absent', () => {
    configValues.LIFECYCLE_EMAILS_ONLY_TO = ' , , ';

    expect(mayReallySend('dav@nadeshiko.co')).toBe(false);
  });
});
