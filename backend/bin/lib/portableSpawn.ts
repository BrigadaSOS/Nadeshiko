/** On Windows `npm`, `npx` and every `node_modules/.bin` entry are `.cmd` shims, which Node can only start through a
 * shell; spawning them by bare name fails with ENOENT. Elsewhere the command passes through untouched. On Windows the
 * command line is joined here rather than handed to the shell as an args array, which Node 24 deprecates (DEP0190).
 *
 * Usage: `const c = portableCommand('npm', ['run', 'x']); spawn(c.command, c.args, { ...options, shell: c.shell })`.
 * Callers keep calling `spawn`/`execFileSync` themselves so their stdio typing is preserved. */
export interface PortableCommand {
  command: string;
  args: string[];
  shell: boolean;
}

function quoteForCmd(arg: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

export function portableCommand(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): PortableCommand {
  if (platform !== 'win32') return { command, args: [...args], shell: false };
  return { command: [command, ...args].map(quoteForCmd).join(' '), args: [], shell: true };
}
