import { describe, expect, it } from 'vitest';
import { portableCommand } from '../../bin/lib/portableSpawn';

describe('portableCommand', () => {
  it('passes the command through untouched off Windows', () => {
    expect(portableCommand('npm', ['run', 'docs:bundle'], 'linux')).toEqual({
      command: 'npm',
      args: ['run', 'docs:bundle'],
      shell: false,
    });
  });

  it('runs through a shell on Windows, where npm and package bins are .cmd shims', () => {
    expect(portableCommand('npm', ['run', 'db:setup'], 'win32')).toEqual({
      command: 'npm run db:setup',
      args: [],
      shell: true,
    });
  });

  it('keeps Windows paths bare and quotes arguments the shell would split', () => {
    const { command } = portableCommand(
      'openapi-code-generator',
      ['--output', 'C:\\repo\\backend\\generated.next', '--title', 'two words'],
      'win32',
    );
    expect(command).toBe('openapi-code-generator --output C:\\repo\\backend\\generated.next --title "two words"');
  });
});
