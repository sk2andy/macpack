import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { log } from "@clack/prompts";
import { confirmOrCancel } from "../core/prompts.js";
import { capture, captureStep, commandExists, runStep } from "../core/exec.js";
import type { ApplyOptions, CleanupOptions, PackageManifest, RunOptions } from "../core/types.js";
import { formatBrewfile } from "../config/brewfile.js";

export function hasBrewEntries(manifest: PackageManifest): boolean {
  return (
    manifest.taps.length > 0 ||
    manifest.brews.length > 0 ||
    manifest.casks.length > 0 ||
    manifest.masApps.length > 0
  );
}

export async function applyBrew(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (!hasBrewEntries(manifest)) return;
  if (options.dryRun) {
    await ensureTaps(manifest.taps, options);
    await installBrews(manifest.brews, options);
    await installCasks(manifest.casks, options);
    await installMasApps(manifest.masApps, options);
    if (options.cleanup) await cleanupBrew(manifest, options);
    return;
  }

  await ensureBrewAvailable();
  const env = await brewEnv(options.env);

  log.info("Homebrew: ensuring taps");
  await ensureTaps(manifest.taps, { ...options, env });
  await promptForTapTrust(manifest.taps, options.yes ?? false, { ...options, env });

  await installBrews(manifest.brews, { ...options, env });
  await installCasks(manifest.casks, { ...options, env });
  await installMasApps(manifest.masApps, { ...options, env });
  if (options.cleanup) {
    log.info("Homebrew: running brew bundle cleanup");
    await cleanupBrew(manifest, { ...options, env });
  }
}

export async function cleanupBrew(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  if (!hasBrewEntries(manifest)) return;
  if (!options.dryRun) {
    await ensureBrewAvailable();
  }
  const env = options.dryRun ? options.env : await brewEnv(options.env);
  const brewfile = await writeTempBrewfile(manifest);
  try {
    await runStep("Homebrew: running brew bundle cleanup", "brew", ["bundle", "cleanup", "--force", "--file", brewfile], { ...options, env });
  } finally {
    await rm(dirname(brewfile), { force: true, recursive: true });
  }
}

export async function doctorBrew(): Promise<string> {
  if (!(await commandExists("brew"))) return "missing";
  const result = await capture("brew", ["--version"]);
  return result.stdout.split("\n")[0] || "installed";
}

async function ensureBrewAvailable(): Promise<void> {
  if (!(await commandExists("brew"))) {
    throw new Error("Homebrew is not installed. Run `macpack setup` first.");
  }
}

async function brewEnv(env: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const xcodeDeveloperDir = "/Applications/Xcode.app/Contents/Developer";
  const selected = await capture("xcode-select", ["-p"]);
  if (!env.DEVELOPER_DIR && selected.stdout.trim() === "/Library/Developer/CommandLineTools") {
    return { ...env, DEVELOPER_DIR: xcodeDeveloperDir };
  }
  return env;
}

async function ensureTaps(taps: string[], options: RunOptions): Promise<void> {
  for (const [index, tap] of taps.entries()) {
    log.info(`Homebrew tap ${index + 1}/${taps.length}: ${tap}`);
    if (options.dryRun) {
      await runStep(`Homebrew tap ${index + 1}/${taps.length}: ${tap}`, "brew", ["tap", tap], options);
      continue;
    }
    const info = await capture("brew", ["tap-info", "--json", tap], options);
    if (info.exitCode === 0 && info.stdout.includes(`"installed": true`)) continue;
    await runStep(`Homebrew tap ${index + 1}/${taps.length}: ${tap}`, "brew", ["tap", tap], options);
  }
}

async function promptForTapTrust(taps: string[], yes: boolean, options: RunOptions): Promise<void> {
  const untrusted = await untrustedTaps(taps, options);
  for (const tap of untrusted) {
    const shouldTrust = yes || (await confirmOrCancel(`Trust Homebrew tap "${tap}" before installing from it?`, true));
    if (shouldTrust) {
      await runStep(`Homebrew: trusting tap ${tap}`, "brew", ["trust", "--tap", tap], options);
    }
  }
}

async function untrustedTaps(taps: string[], options: RunOptions): Promise<string[]> {
  if (taps.length === 0) return [];
  const trusted = await capture("brew", ["trust", "--json", "v1", "--tap"], options);
  const trustedTaps = trusted.exitCode === 0 ? (JSON.parse(trusted.stdout || "[]") as string[]) : [];
  const result: string[] = [];

  for (const tap of taps) {
    const info = await capture("brew", ["tap-info", "--json", tap], options);
    if (info.exitCode !== 0) continue;
    const entries = JSON.parse(info.stdout || "[]") as Array<{ official?: boolean; trusted?: boolean }>;
    const tapInfo = entries[0];
    if (!tapInfo || tapInfo.official || tapInfo.trusted || trustedTaps.includes(tap)) continue;
    result.push(tap);
  }

  return result;
}

async function writeTempBrewfile(manifest: PackageManifest): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "macpack-"));
  const path = join(dir, "Brewfile");
  await writeFile(path, formatBrewfile(manifest), "utf8");
  return path;
}

async function installBrews(brews: string[], options: RunOptions): Promise<void> {
  if (brews.length === 0) return;
  const outdatedBrews = options.dryRun ? new Set<string>() : await outdatedBrewNames(options);

  for (const [index, brew] of brews.entries()) {
    const label = `Homebrew brew ${index + 1}/${brews.length}: ${brew}`;
    const installedResult = options.dryRun
      ? { stdout: "", stderr: "", exitCode: 1 }
      : await capture("brew", ["list", "--formula", "--versions", brew], options);
    const installed = installedResult.exitCode === 0;
    if (installed && !packageIsOutdated(outdatedBrews, brew, installedResult.stdout)) {
      log.success(`${label} (up to date)`);
      continue;
    }

    const args = installed ? ["upgrade", "--formula", brew] : ["install", "--formula", brew];
    await runStep(`${label}: ${installed ? "updating" : "installing"}`, "brew", args, options);
  }
}

function packageIsOutdated(outdatedPackages: Set<string>, packageName: string, installedVersions: string): boolean {
  const shortName = packageName.split("/").at(-1) ?? packageName;
  const canonicalName = installedVersions.trim().split(/\s+/)[0];
  return outdatedPackages.has(packageName) || outdatedPackages.has(shortName) || outdatedPackages.has(canonicalName);
}

async function outdatedBrewNames(options: RunOptions): Promise<Set<string>> {
  const result = await capture("brew", ["outdated", "--formula", "--json=v2"], options);
  if (result.exitCode !== 0) {
    throw new Error(commandFailure("brew outdated --formula --json=v2", "", result.stdout, result.stderr, result.exitCode));
  }
  const data = JSON.parse(result.stdout || "{}") as { formulae?: Array<{ name: string }> };
  return new Set((data.formulae ?? []).map((brew) => brew.name));
}

async function installCasks(casks: string[], options: RunOptions): Promise<void> {
  if (casks.length === 0) return;
  const outdatedCasks = options.dryRun ? new Set<string>() : await outdatedCaskNames(options);

  for (const [index, cask] of casks.entries()) {
    const label = `Homebrew cask ${index + 1}/${casks.length}: ${cask}`;
    const installed = options.dryRun ? false : (await capture("brew", ["list", "--cask", "--versions", cask], options)).exitCode === 0;
    if (installed && !outdatedCasks.has(cask)) {
      log.info(`${label} (up to date)`);
      continue;
    }

    const command = installed ? "brew upgrade --cask" : "brew install --cask --force";
    const args = installed ? ["upgrade", "--cask", cask] : ["install", "--cask", "--force", cask];
    const result = await captureStep(`${label}: ${installed ? "updating" : "installing"}`, "brew", args, options);
    if (result.exitCode === 0) continue;

    if (!installed && isUnavailableCask(result.stdout, result.stderr)) {
      log.warn(`Skipping unavailable Homebrew cask "${cask}". Remove or rename it in your manifest.`);
      continue;
    }

    throw new Error(commandFailure(command, cask, result.stdout, result.stderr, result.exitCode));
  }
}

async function outdatedCaskNames(options: RunOptions): Promise<Set<string>> {
  const result = await capture("brew", ["outdated", "--cask", "--json=v2"], options);
  if (result.exitCode !== 0) {
    throw new Error(commandFailure("brew outdated --cask --json=v2", "", result.stdout, result.stderr, result.exitCode));
  }
  const data = JSON.parse(result.stdout || "{}") as { casks?: Array<{ name: string }> };
  return new Set((data.casks ?? []).map((cask) => cask.name));
}

async function installMasApps(apps: PackageManifest["masApps"], options: RunOptions): Promise<void> {
  if (apps.length === 0) return;
  if (!options.dryRun && !(await commandExists("mas"))) {
    throw new Error("mas is not installed. Add `brew \"mas\"` to the manifest or install it first.");
  }

  const installedIds = options.dryRun ? new Set<string>() : await masAppIds("list", options);
  const outdatedIds = options.dryRun ? new Set<string>() : await masAppIds("outdated", options);
  for (const [index, app] of apps.entries()) {
    const label = `Homebrew MAS ${index + 1}/${apps.length}: ${app.name}`;
    if (installedIds.has(app.id)) {
      if (!outdatedIds.has(app.id)) {
        log.info(`${label} (up to date)`);
        continue;
      }
      await runStep(`${label}: updating`, "mas", ["update", app.id], options);
      continue;
    }

    const installed = await captureStep(`${label}: installing`, "mas", ["install", app.id], options);
    if (installed.exitCode === 0) continue;

    const acquired = await captureStep(`${label}: getting`, "mas", ["get", app.id], options);
    if (acquired.exitCode === 0) continue;

    throw new Error(commandFailure("mas get", `${app.name} (${app.id})`, acquired.stdout, acquired.stderr, acquired.exitCode));
  }
}

async function masAppIds(command: "list" | "outdated", options: RunOptions): Promise<Set<string>> {
  const result = await capture("mas", [command], options);
  if (result.exitCode !== 0) return new Set();
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  );
}

function isUnavailableCask(stdout: string, stderr: string): boolean {
  const output = `${stdout}\n${stderr}`;
  return /Cask '.*' is unavailable|No Cask with this name exists/i.test(output);
}

function commandFailure(command: string, name: string, stdout: string, stderr: string, exitCode: number): string {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  const rendered = [command, name].filter(Boolean).join(" ");
  return `${rendered} failed with exit code ${exitCode}${output ? `\n${output}` : ""}`;
}
