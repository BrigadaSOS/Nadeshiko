import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `config` is frozen at module load, so varying it means standing something else
 * in front of it.
 *
 * A Proxy over an UNFROZEN COPY rather than over the real object: a `get` trap
 * that returns something other than a non-writable, non-configurable property's
 * own value is a TypeError, and `Object.freeze` makes every key exactly that.
 * Everything not overridden falls through to the real value, so the rest of the
 * import chain -- which reaches Elasticsearch on the way in -- still gets a
 * config it can use.
 */
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
  /**
   * The state this feature ships in. Everything below is a variation on "and it
   * still does not send".
   */
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

  /**
   * Addresses are compared in one normalized shape everywhere else in the email
   * code; an allowlist that was case-sensitive would silently not match the
   * address somebody typed into the environment.
   */
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

  /**
   * A value that parses to nothing is a mistake, and the safe reading of a
   * mistake here is "nobody" rather than "everybody".
   */
  it('treats an allowlist of separators as empty, not absent', () => {
    configValues.LIFECYCLE_EMAILS_ONLY_TO = ' , , ';

    expect(mayReallySend('dav@nadeshiko.co')).toBe(false);
  });
});
