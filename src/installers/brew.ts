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
    const brewfile = await writeTempBrewfile(manifest);
    try {
      await runStep("Homebrew: running brew bundle", "brew", ["bundle", "--file", brewfile], options);
      if (options.cleanup) {
        await runStep("Homebrew: running brew bundle cleanup", "brew", ["bundle", "cleanup", "--force", "--file", brewfile], options);
      }
    } finally {
      await rm(dirname(brewfile), { force: true, recursive: true });
    }
    return;
  }

  await ensureBrewAvailable();
  const env = await brewEnv(options.env);

  log.info("Homebrew: ensuring taps");
  await ensureTaps(manifest.taps, { ...options, env });
  await promptForTapTrust(manifest.taps, options.yes ?? false, { ...options, env });

  const skippedCasks = await installMissingCasksWithForce(manifest.casks, { ...options, env });
  const effectiveManifest = skippedCasks.size > 0 ? withoutCasks(manifest, skippedCasks) : manifest;
  const brewfile = await writeTempBrewfile(effectiveManifest);
  try {
    await runStep("Homebrew: running brew bundle", "brew", ["bundle", "--file", brewfile], { ...options, env });
    if (options.cleanup) {
      log.info("Homebrew: running brew bundle cleanup");
      await cleanupBrew(manifest, { ...options, env });
    }
  } finally {
    await rm(dirname(brewfile), { force: true, recursive: true });
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

async function installMissingCasksWithForce(casks: string[], options: RunOptions): Promise<Set<string>> {
  const skipped = new Set<string>();
  if (casks.length === 0) return skipped;

  log.info(`Homebrew: checking ${casks.length} casks`);
  for (const [index, cask] of casks.entries()) {
    log.info(`Homebrew cask ${index + 1}/${casks.length}: ${cask}`);
    const installed = await capture("brew", ["list", "--cask", "--versions", cask], options);
    if (installed.exitCode === 0) continue;

    const result = await captureStep(`Homebrew cask ${index + 1}/${casks.length}: installing ${cask}`, "brew", [
      "install",
      "--cask",
      "--force",
      cask,
    ], options);
    if (result.exitCode === 0) continue;

    if (isUnavailableCask(result.stdout, result.stderr)) {
      skipped.add(cask);
      log.warn(`Skipping unavailable Homebrew cask "${cask}". Remove or rename it in your manifest.`);
      continue;
    }

    throw new Error(commandFailure("brew install --cask --force", cask, result.stdout, result.stderr, result.exitCode));
  }

  return skipped;
}

function withoutCasks(manifest: PackageManifest, skipped: Set<string>): PackageManifest {
  return {
    ...manifest,
    casks: manifest.casks.filter((cask) => !skipped.has(cask)),
  };
}

function isUnavailableCask(stdout: string, stderr: string): boolean {
  const output = `${stdout}\n${stderr}`;
  return /Cask '.*' is unavailable|No Cask with this name exists/i.test(output);
}

function commandFailure(command: string, name: string, stdout: string, stderr: string, exitCode: number): string {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return `${command} ${name} failed with exit code ${exitCode}${output ? `\n${output}` : ""}`;
}
