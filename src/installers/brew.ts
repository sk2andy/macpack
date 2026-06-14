import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { confirmOrCancel } from "../core/prompts.js";
import { capture, commandExists, run } from "../core/exec.js";
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
      await run("brew", ["bundle", "--file", brewfile], options);
      if (options.cleanup) {
        await run("brew", ["bundle", "cleanup", "--force", "--file", brewfile], options);
      }
    } finally {
      await rm(dirname(brewfile), { force: true, recursive: true });
    }
    return;
  }

  await ensureBrewAvailable();
  const env = await brewEnv(options.env);

  await ensureTaps(manifest.taps, { ...options, env });
  await promptForTapTrust(manifest.taps, options.yes ?? false, { ...options, env });

  const brewfile = await writeTempBrewfile(manifest);
  try {
    await installMissingCasksWithForce(manifest.casks, { ...options, env });
    await run("brew", ["bundle", "--file", brewfile], { ...options, env });
    if (options.cleanup) {
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
    await run("brew", ["bundle", "cleanup", "--force", "--file", brewfile], { ...options, env });
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
  for (const tap of taps) {
    const info = await capture("brew", ["tap-info", "--json", tap], options);
    if (info.exitCode === 0 && info.stdout.includes(`"installed": true`)) continue;
    await run("brew", ["tap", tap], options);
  }
}

async function promptForTapTrust(taps: string[], yes: boolean, options: RunOptions): Promise<void> {
  const untrusted = await untrustedTaps(taps, options);
  for (const tap of untrusted) {
    const shouldTrust = yes || (await confirmOrCancel(`Trust Homebrew tap "${tap}" before installing from it?`, true));
    if (shouldTrust) {
      await run("brew", ["trust", "--tap", tap], options);
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

async function installMissingCasksWithForce(casks: string[], options: RunOptions): Promise<void> {
  for (const cask of casks) {
    const installed = await capture("brew", ["list", "--cask", "--versions", cask], options);
    if (installed.exitCode === 0) continue;
    await run("brew", ["install", "--cask", "--force", cask], options);
  }
}
