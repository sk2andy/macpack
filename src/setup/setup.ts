import { homedir } from "node:os";
import { join } from "node:path";
import { cancel, confirm, intro, isCancel, note, outro, select, spinner, text } from "@clack/prompts";
import { assertMacOS } from "../core/platform.js";
import { commandExists, run } from "../core/exec.js";
import { collectGitRepositories, collectInstalledManifest } from "../config/discovery.js";
import { emptyManifest, parseManifestFile } from "../config/parser.js";
import { configManifestPath, ensureManifestFile, pathExists, writeManifestFile } from "../config/defaults.js";
import type { PackageManifest } from "../core/types.js";

type NodeInstallChoice = "volta" | "brew-node" | "nvm" | "skip";
type BunInstallChoice = "official" | "brew" | "skip";
type PythonInstallChoice = "uv-python" | "pyenv" | "brew-python" | "skip";
type UvInstallChoice = "brew" | "official" | "skip";

export async function runSetup(options: { dryRun?: boolean } = {}): Promise<void> {
  assertMacOS();
  intro("macpack setup");

  await ensureHomebrew(options);
  await ensureNode(options);
  await ensureBun(options);
  await ensurePython(options);
  await ensureUv(options);
  await ensureDefaultManifest(options);

  outro("Setup complete.");
}

async function ensureHomebrew(options: { dryRun?: boolean }): Promise<void> {
  if (await commandExists("brew")) return;

  const shouldInstall = await askConfirm("Homebrew is missing. Install Homebrew now?", true);
  if (!shouldInstall) return;

  await withSpinner("Installing Homebrew", () =>
    run("sh", ["-lc", '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'], options),
  );
  prependPath("/opt/homebrew/bin", "/usr/local/bin");
}

async function ensureNode(options: { dryRun?: boolean }): Promise<void> {
  if (await commandExists("node")) return;

  const choice = await askSelect<NodeInstallChoice>("Node.js is missing. How should it be installed?", [
    { value: "volta", label: "Volta", hint: "recommended" },
    { value: "brew-node", label: "Homebrew node" },
    { value: "nvm", label: "nvm" },
    { value: "skip", label: "Skip" },
  ]);

  switch (choice) {
    case "volta":
      await installVolta(options);
      prependPath(join(homedir(), ".volta/bin"));
      await withSpinner("Installing Node.js with Volta", () => run("volta", ["install", "node"], options));
      break;
    case "brew-node":
      await ensureHomebrew(options);
      prependPath("/opt/homebrew/bin", "/usr/local/bin");
      await withSpinner("Installing Node.js with Homebrew", () => run("brew", ["install", "node"], options));
      break;
    case "nvm":
      await withSpinner("Installing nvm", () =>
        run("sh", ["-lc", "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"], options),
      );
      note("Open a new shell, then run `nvm install --lts`.", "nvm installed");
      break;
    case "skip":
      break;
  }
}

async function ensureBun(options: { dryRun?: boolean }): Promise<void> {
  if (await commandExists("bun")) return;

  const shouldInstall = await askConfirm("bun is missing. Install bun?", true);
  if (!shouldInstall) return;

  const choice = await askSelect<BunInstallChoice>("Choose bun install source", [
    { value: "official", label: "Official bun installer", hint: "recommended" },
    { value: "brew", label: "Homebrew cask/formula" },
    { value: "skip", label: "Skip" },
  ]);

  switch (choice) {
    case "official":
      await withSpinner("Installing bun", () => run("sh", ["-lc", "curl -fsSL https://bun.sh/install | bash"], options));
      prependPath(join(homedir(), ".bun/bin"));
      break;
    case "brew":
      await ensureHomebrew(options);
      prependPath("/opt/homebrew/bin", "/usr/local/bin");
      await withSpinner("Installing bun with Homebrew", () => run("brew", ["install", "oven-sh/bun/bun"], options));
      break;
    case "skip":
      break;
  }
}

async function ensurePython(options: { dryRun?: boolean }): Promise<void> {
  if (await commandExists("python3")) return;

  const version = await askText("Python 3 is missing. Which default Python version?", "3.14");
  const choice = await askSelect<PythonInstallChoice>("Choose Python install source", [
    { value: "uv-python", label: "uv-managed Python", hint: "recommended" },
    { value: "pyenv", label: "pyenv" },
    { value: "brew-python", label: "Homebrew python" },
    { value: "skip", label: "Skip" },
  ]);

  switch (choice) {
    case "uv-python":
      await ensureUv(options);
      prependPath(join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin");
      await withSpinner(`Installing Python ${version} with uv`, () => run("uv", ["python", "install", version], options));
      break;
    case "pyenv":
      await ensureHomebrew(options);
      prependPath("/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".pyenv/bin"));
      await withSpinner("Installing pyenv", () => run("brew", ["install", "pyenv"], options));
      await withSpinner(`Installing Python ${version} with pyenv`, () => run("pyenv", ["install", "-s", version], options));
      await run("pyenv", ["global", version], options);
      break;
    case "brew-python":
      await ensureHomebrew(options);
      prependPath("/opt/homebrew/bin", "/usr/local/bin");
      await withSpinner("Installing Python with Homebrew", () => run("brew", ["install", `python@${version}`], options));
      break;
    case "skip":
      break;
  }
}

async function ensureUv(options: { dryRun?: boolean }): Promise<void> {
  if (await commandExists("uv")) return;

  const shouldInstall = await askConfirm("uv is missing. Install uv?", true);
  if (!shouldInstall) return;

  const choice = await askSelect<UvInstallChoice>("Choose uv install source", [
    { value: "brew", label: "Homebrew", hint: "recommended for macpack" },
    { value: "official", label: "Official Astral installer" },
    { value: "skip", label: "Skip" },
  ]);

  switch (choice) {
    case "brew":
      await ensureHomebrew(options);
      prependPath("/opt/homebrew/bin", "/usr/local/bin");
      await withSpinner("Installing uv with Homebrew", () => run("brew", ["install", "uv"], options));
      break;
    case "official":
      await withSpinner("Installing uv", () => run("sh", ["-lc", "curl -LsSf https://astral.sh/uv/install.sh | sh"], options));
      prependPath(join(homedir(), ".local/bin"));
      break;
    case "skip":
      break;
  }
}

async function ensureDefaultManifest(options: { dryRun?: boolean }): Promise<void> {
  const manifestPath = configManifestPath();
  const exists = await pathExists(manifestPath);

  if (!exists) {
    const shouldCreate = await askConfirm(`Create default manifest at ${manifestPath}?`, true);
    if (!shouldCreate) return;
  }

  const shouldPrefill = await askConfirm("Scan currently installed packages for the global manifest?", true);
  const shouldScanRepos = await askConfirm("Scan your home folder for git repositories?", false);

  if (options.dryRun) {
    note(manifestPath, exists ? "Would update global manifest" : "Would create default manifest");
    return;
  }

  if (!shouldPrefill && !shouldScanRepos) {
    await ensureManifestFile(manifestPath);
    note(manifestPath, exists ? "Global manifest unchanged" : "Default manifest created");
    return;
  }

  const manifest = exists ? await parseManifestFile(manifestPath) : emptyManifest();
  const uvPython = shouldPrefill ? await askText("Python version for discovered uv tools", "3.14") : undefined;
  if (shouldPrefill) {
    mergeManifest(manifest, await withSpinner("Collecting installed packages", () => collectInstalledManifest({ uvPython })));
  }

  if (shouldScanRepos) {
    manifest.repos.push(...(await withSpinner("Scanning home folder for git repositories", () => collectGitRepositories())));
  }

  await writeManifestFile(manifestPath, dedupeManifest(manifest));
  const sources = [shouldPrefill ? "installed packages" : undefined, shouldScanRepos ? "git repositories" : undefined].filter(Boolean);
  note(manifestPath, `${exists ? "Global manifest updated" : "Default manifest created"} from ${sources.join(" and ")}`);
}

function mergeManifest(target: PackageManifest, source: PackageManifest): void {
  target.taps.push(...source.taps);
  target.brews.push(...source.brews);
  target.casks.push(...source.casks);
  target.masApps.push(...source.masApps);
  target.npmPackages.push(...source.npmPackages);
  target.pnpmPackages.push(...source.pnpmPackages);
  target.bunPackages.push(...source.bunPackages);
  target.uvTools.push(...source.uvTools);
  target.repos.push(...source.repos);
}

function dedupeManifest(manifest: PackageManifest): PackageManifest {
  return {
    taps: uniqueSorted(manifest.taps),
    brews: uniqueSorted(manifest.brews),
    casks: uniqueSorted(manifest.casks),
    masApps: uniqueBy(manifest.masApps, (app) => app.id).sort((left, right) => left.name.localeCompare(right.name)),
    npmPackages: uniqueSorted(manifest.npmPackages),
    pnpmPackages: uniqueSorted(manifest.pnpmPackages),
    bunPackages: uniqueSorted(manifest.bunPackages),
    uvTools: uniqueBy(manifest.uvTools, (tool) => tool.packageName).sort((left, right) =>
      left.packageName.localeCompare(right.packageName),
    ),
    repos: uniqueBy(manifest.repos, (repo) => repo.targetDir).sort((left, right) => left.targetDir.localeCompare(right.targetDir)),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

async function installVolta(options: { dryRun?: boolean }): Promise<void> {
  if (await commandExists("volta")) return;
  await withSpinner("Installing Volta", () => run("sh", ["-lc", "curl https://get.volta.sh | bash"], options));
  prependPath(join(homedir(), ".volta/bin"));
  note("Open a new shell if `volta` is not available immediately.", "Volta installed");
}

function prependPath(...paths: string[]): void {
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  const next = paths.filter((path) => !current.includes(path));
  process.env.PATH = [...next, ...current].join(":");
}

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const s = spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop(message);
    return result;
  } catch (error) {
    s.stop(`${message} failed`);
    throw error;
  }
}

async function askConfirm(message: string, initialValue: boolean): Promise<boolean> {
  const answer = await confirm({ message, initialValue });
  if (isCancel(answer)) {
    cancel("Cancelled.");
    process.exit(130);
  }
  return answer;
}

async function askSelect<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>,
): Promise<T> {
  const answer = await select({ message, options: options as never });
  if (isCancel(answer)) {
    cancel("Cancelled.");
    process.exit(130);
  }
  return answer as T;
}

async function askText(message: string, placeholder: string): Promise<string> {
  const answer = await text({
    message,
    placeholder,
    defaultValue: placeholder,
    validate: (value) => (value?.trim() ? undefined : "Version is required"),
  });
  if (isCancel(answer)) {
    cancel("Cancelled.");
    process.exit(130);
  }
  return answer;
}
