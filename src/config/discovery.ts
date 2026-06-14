import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { emptyManifest } from "./parser.js";
import { capture, commandExists } from "../core/exec.js";
import type { PackageManifest, RunOptions } from "../core/types.js";

export interface DiscoveryOptions extends RunOptions {
  uvPython?: string;
}

export async function collectInstalledManifest(options: DiscoveryOptions = {}): Promise<PackageManifest> {
  const manifest = emptyManifest();

  await collectHomebrew(manifest, options);
  await collectMas(manifest, options);
  await collectNpm(manifest, options);
  await collectPnpm(manifest, options);
  await collectBun(manifest);
  await collectUv(manifest, options);

  return dedupeManifest(manifest);
}

export function parseMasList(source: string): Array<{ name: string; id: string }> {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.+?)(?:\s+\([^)]+\))?$/);
      if (!match) return [];
      return [{ id: match[1], name: match[2].trim() }];
    });
}

export function parseUvToolList(source: string, python: string): Array<{ python: string; packageName: string }> {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("-") && /^\S+ v\d/.test(line))
    .map((line) => ({
      python,
      packageName: line.split(/\s+/)[0],
    }));
}

async function collectHomebrew(manifest: PackageManifest, options: RunOptions): Promise<void> {
  if (!(await commandExists("brew"))) return;
  manifest.taps.push(...(await linesFrom("brew", ["tap"], options)));
  manifest.brews.push(...(await linesFrom("brew", ["leaves"], options)));
  manifest.casks.push(...(await linesFrom("brew", ["list", "--cask"], options)));
}

async function collectMas(manifest: PackageManifest, options: RunOptions): Promise<void> {
  if (!(await commandExists("mas"))) return;
  const result = await capture("mas", ["list"], options);
  if (result.exitCode !== 0) return;
  manifest.masApps.push(...parseMasList(result.stdout));
}

async function collectNpm(manifest: PackageManifest, options: RunOptions): Promise<void> {
  if (await commandExists("npm")) {
    const result = await capture("npm", ["ls", "-g", "--depth=0", "--json"], options);
    if (result.stdout.trim()) {
      const data = JSON.parse(result.stdout) as { dependencies?: Record<string, unknown> };
      manifest.npmPackages.push(...Object.keys(data.dependencies ?? {}));
    }
  }

  if (await commandExists("volta")) {
    const result = await capture("volta", ["list", "all"], options);
    if (result.exitCode === 0) {
      manifest.npmPackages.push(...parseVoltaPackages(result.stdout));
    }
  }
}

async function collectPnpm(manifest: PackageManifest, options: RunOptions): Promise<void> {
  if (!(await commandExists("pnpm"))) return;
  const result = await capture("pnpm", ["list", "-g", "--depth=0", "--json"], options);
  if (result.exitCode !== 0 || !result.stdout.trim()) return;
  const data = JSON.parse(result.stdout) as Array<{ dependencies?: Record<string, unknown> }> | {
    dependencies?: Record<string, unknown>;
  };
  const root = Array.isArray(data) ? data[0] : data;
  manifest.pnpmPackages.push(...Object.keys(root?.dependencies ?? {}));
}

async function collectBun(manifest: PackageManifest): Promise<void> {
  const root = process.env.BUN_INSTALL || join(homedir(), ".bun");
  try {
    const data = JSON.parse(await readFile(join(root, "install/global/package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    manifest.bunPackages.push(...Object.keys(data.dependencies ?? {}));
  } catch {
    // No global bun package manifest exists.
  }
}

async function collectUv(manifest: PackageManifest, options: DiscoveryOptions): Promise<void> {
  if (!(await commandExists("uv"))) return;
  const result = await capture("uv", ["tool", "list"], options);
  if (result.exitCode !== 0) return;
  manifest.uvTools.push(...parseUvToolList(result.stdout, options.uvPython ?? "3.14"));
}

async function linesFrom(command: string, args: string[], options: RunOptions): Promise<string[]> {
  const result = await capture(command, args, options);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseVoltaPackages(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package "))
    .map((line) => line.split(/\s+/)[1])
    .filter(Boolean)
    .map((spec) => packageNameFromSpec(spec));
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

function packageNameFromSpec(spec: string): string {
  if (spec.startsWith("@")) {
    const versionIndex = spec.indexOf("@", 1);
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  }
  const versionIndex = spec.indexOf("@");
  return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
}
