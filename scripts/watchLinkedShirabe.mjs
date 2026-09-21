import { spawn } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = [
	{ name: "@shirabe-org/api", consumer: "backend" },
	{ name: "@shirabe-org/api", consumer: "frontend" },
	{ name: "@shirabe-org/card", consumer: "frontend" },
];
const children = [];
const watchedDirectories = new Set();
let stopping = false;

for (const { name, consumer } of packages) {
	const requireFromConsumer = createRequire(
		join(root, consumer, "package.json"),
	);
	const nodeModulesDirectory = requireFromConsumer.resolve
		.paths(name)
		?.find((directory) => existsSync(join(directory, name)));
	if (!nodeModulesDirectory) continue;

	const packageLink = join(nodeModulesDirectory, name);
	const packageDirectory = realpathSync(packageLink);
	const relativePackageDirectory = relative(
		nodeModulesDirectory,
		packageDirectory,
	);
	if (
		!lstatSync(packageLink).isSymbolicLink() ||
		(relativePackageDirectory !== ".." &&
			!relativePackageDirectory.startsWith(`..${sep}`))
	)
		continue;
	if (watchedDirectories.has(packageDirectory)) continue;
	watchedDirectories.add(packageDirectory);

	process.stdout.write(`[shirabe] Watching ${name} at ${packageDirectory}\n`);
	const child = spawn("npm", ["run", "watch"], {
		cwd: packageDirectory,
		stdio: "inherit",
	});
	children.push(child);
	child.on("exit", (code, signal) => {
		if (stopping) return;
		stopping = true;
		for (const other of children) if (other !== child) other.kill("SIGTERM");
		process.exitCode = signal ? 1 : (code ?? 1);
	});
}

if (children.length === 0)
	process.stdout.write("[shirabe] No locally linked SDK packages to watch.\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		stopping = true;
		for (const child of children) child.kill(signal);
		process.exitCode = 0;
	});
}
