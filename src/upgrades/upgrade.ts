import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { capture, commandExists } from "../core/exec.js";
import type { ApplyOptions, PackageManifest, RunOptions } from "../core/types.js";
import { applyAll } from "../installers/index.js";

export type UpgradeManager = "brew" | "npm" | "pnpm" | "bun" | "uv";

export interface UpgradeCandidate {
  id: string;
  manager: UpgradeManager;
  kind: "brew" | "cask" | "mas" | "npm" | "pnpm" | "bun" | "uv";
  name: string;
  current: string;
  latest: string;
  manifestEntry: string;
  python?: string;
}

export function selectedManagers(manager?: string): Set<UpgradeManager> {
  if (!manager || manager === "all") return new Set(["brew", "npm", "pnpm", "bun", "uv"]);
  if (["brew", "npm", "pnpm", "bun", "uv"].includes(manager)) return new Set([manager as UpgradeManager]);
  throw new Error(`Unsupported upgrade manager "${manager}". Use brew, npm, pnpm, bun, uv, or all.`);
}

export function manifestForManagers(manifest: PackageManifest, managers: Set<UpgradeManager>): PackageManifest {
  return {
    taps: managers.has("brew") ? manifest.taps : [],
    brews: managers.has("brew") ? manifest.brews : [],
    casks: managers.has("brew") ? manifest.casks : [],
    masApps: managers.has("brew") ? manifest.masApps : [],
    npmPackages: managers.has("npm") ? manifest.npmPackages : [],
    pnpmPackages: managers.has("pnpm") ? manifest.pnpmPackages : [],
    bunPackages: managers.has("bun") ? manifest.bunPackages : [],
    uvTools: managers.has("uv") ? manifest.uvTools : [],
  };
}

export async function collectUpgradeCandidates(
  manifest: PackageManifest,
  managers: Set<UpgradeManager>,
  options: RunOptions = {},
): Promise<UpgradeCandidate[]> {
  const candidates: UpgradeCandidate[] = [];
  if (managers.has("brew")) candidates.push(...(await brewCandidates(manifest, options)));
  if (managers.has("npm")) candidates.push(...(await npmCandidates(manifest, options)));
  if (managers.has("pnpm")) candidates.push(...(await pnpmCandidates(manifest, options)));
  if (managers.has("bun")) candidates.push(...(await bunCandidates(manifest, options)));
  if (managers.has("uv")) candidates.push(...(await uvCandidates(manifest, options)));
  return candidates;
}

export async function applyUpgradeCandidates(candidates: UpgradeCandidate[], options: ApplyOptions = {}): Promise<void> {
  await applyAll(manifestForCandidates(candidates), options);
}

function manifestForCandidates(candidates: UpgradeCandidate[]): PackageManifest {
  const manifest: PackageManifest = {
    taps: [],
    brews: [],
    casks: [],
    masApps: [],
    npmPackages: [],
    pnpmPackages: [],
    bunPackages: [],
    uvTools: [],
  };

  for (const candidate of candidates) {
    switch (candidate.kind) {
      case "brew":
        manifest.brews.push(candidate.manifestEntry);
        break;
      case "cask":
        manifest.casks.push(candidate.manifestEntry);
        break;
      case "mas":
        manifest.masApps.push({ name: candidate.name, id: candidate.manifestEntry });
        break;
      case "npm":
        manifest.npmPackages.push(candidate.manifestEntry);
        break;
      case "pnpm":
        manifest.pnpmPackages.push(candidate.manifestEntry);
        break;
      case "bun":
        manifest.bunPackages.push(candidate.manifestEntry);
        break;
      case "uv":
        manifest.uvTools.push({ python: candidate.python ?? "3.14", packageName: candidate.manifestEntry });
        break;
    }
  }

  return manifest;
}

async function brewCandidates(manifest: PackageManifest, options: RunOptions): Promise<UpgradeCandidate[]> {
  if (!(await commandExists("brew"))) return [];
  const result = await capture("brew", ["outdated", "--json=v2"], options);
  if (!result.stdout.trim()) return [];
  const data = JSON.parse(result.stdout) as {
    formulae?: Array<{ name: string; installed_versions?: string[]; current_version?: string }>;
    casks?: Array<{ name: string; installed_versions?: string[]; current_version?: string }>;
  };

  const brews = new Set(manifest.brews);
  const casks = new Set(manifest.casks);
  const candidates: UpgradeCandidate[] = [];

  for (const formula of data.formulae ?? []) {
    if (!brews.has(formula.name)) continue;
    candidates.push({
      id: `brew:brew:${formula.name}`,
      manager: "brew",
      kind: "brew",
      name: formula.name,
      current: formula.installed_versions?.join(", ") || "installed",
      latest: formula.current_version ?? "latest",
      manifestEntry: formula.name,
    });
  }

  for (const cask of data.casks ?? []) {
    if (!casks.has(cask.name)) continue;
    candidates.push({
      id: `brew:cask:${cask.name}`,
      manager: "brew",
      kind: "cask",
      name: cask.name,
      current: cask.installed_versions?.join(", ") || "installed",
      latest: cask.current_version ?? "latest",
      manifestEntry: cask.name,
    });
  }

  if (manifest.masApps.length > 0 && (await commandExists("mas"))) {
    candidates.push(...(await masCandidates(manifest, options)));
  }

  return candidates;
}

async function masCandidates(manifest: PackageManifest, options: RunOptions): Promise<UpgradeCandidate[]> {
  const result = await capture("mas", ["outdated"], options);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  const appsById = new Map(manifest.masApps.map((app) => [app.id, app.name]));
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.+?)\s+\(([^)]+)\s*->\s*([^)]+)\)/);
      if (!match) return [];
      const [, id, name, current, latest] = match;
      if (!appsById.has(id)) return [];
      return [
        {
          id: `brew:mas:${id}`,
          manager: "brew" as const,
          kind: "mas" as const,
          name: appsById.get(id) ?? name,
          current,
          latest,
          manifestEntry: id,
        },
      ];
    });
}

async function npmCandidates(manifest: PackageManifest, options: RunOptions): Promise<UpgradeCandidate[]> {
  if (manifest.npmPackages.length === 0 || !(await commandExists("npm"))) return [];
  const installed = new Map([...await installedNpmVersions(options), ...await installedVoltaVersions(options)]);
  return packageCandidates("npm", manifest.npmPackages, installed, (name) => latestVersion("npm", name, options));
}

async function pnpmCandidates(manifest: PackageManifest, options: RunOptions): Promise<UpgradeCandidate[]> {
  if (manifest.pnpmPackages.length === 0 || !(await commandExists("pnpm"))) return [];
  const installed = await installedPnpmVersions(options);
  return packageCandidates("pnpm", manifest.pnpmPackages, installed, (name) => latestVersion("pnpm", name, options));
}

async function bunCandidates(manifest: PackageManifest, options: RunOptions): Promise<UpgradeCandidate[]> {
  if (manifest.bunPackages.length === 0 || !(await commandExists("bun"))) return [];
  const installed = await installedBunVersions();
  return packageCandidates("bun", manifest.bunPackages, installed, (name) => latestBunVersion(name, options));
}

async function uvCandidates(manifest: PackageManifest, options: RunOptions): Promise<UpgradeCandidate[]> {
  if (manifest.uvTools.length === 0 || !(await commandExists("uv"))) return [];
  const outdated = await capture("uv", ["tool", "list", "--outdated"], options);
  const installed = await installedUvVersions(options);
  const byName = new Map(manifest.uvTools.map((tool) => [pythonPackageName(tool.packageName), tool]));
  const candidates: UpgradeCandidate[] = [];

  if (outdated.exitCode === 0 && outdated.stdout.trim()) {
    for (const line of outdated.stdout.split("\n")) {
      const match = line.trim().match(/^([^\s]+)\s+v?([^\s]+)\s+\[latest:\s*v?([^\]]+)\]/);
      if (!match) continue;
      const [, name, current, latest] = match;
      const tool = byName.get(name);
      if (!tool) continue;
      candidates.push({
        id: `uv:uv:${name}`,
        manager: "uv",
        kind: "uv",
        name,
        current,
        latest,
        manifestEntry: tool.packageName,
        python: tool.python,
      });
    }
    return candidates;
  }

  for (const tool of manifest.uvTools) {
    const name = pythonPackageName(tool.packageName);
    if (!installed.has(name)) {
      candidates.push({
        id: `uv:uv:${name}`,
        manager: "uv",
        kind: "uv",
        name,
        current: "missing",
        latest: "latest",
        manifestEntry: tool.packageName,
        python: tool.python,
      });
    }
  }

  return candidates;
}

async function packageCandidates(
  manager: Extract<UpgradeManager, "npm" | "pnpm" | "bun">,
  specs: string[],
  installed: Map<string, string>,
  latestFor: (name: string) => Promise<string | undefined>,
): Promise<UpgradeCandidate[]> {
  const candidates: UpgradeCandidate[] = [];
  for (const spec of specs) {
    const name = nodePackageName(spec);
    const current = installed.get(name) ?? "missing";
    const latest = await latestFor(name);
    if (!latest || sameVersion(current, latest)) continue;
    candidates.push({
      id: `${manager}:${manager}:${name}`,
      manager,
      kind: manager,
      name,
      current,
      latest,
      manifestEntry: spec,
    });
  }
  return candidates;
}

async function installedNpmVersions(options: RunOptions): Promise<Map<string, string>> {
  const result = await capture("npm", ["ls", "-g", "--depth=0", "--json"], options);
  if (result.exitCode !== 0 && !result.stdout.trim()) return new Map();
  const data = JSON.parse(result.stdout || "{}") as { dependencies?: Record<string, { version?: string }> };
  return dependencyVersions(data.dependencies);
}

async function installedVoltaVersions(options: RunOptions): Promise<Map<string, string>> {
  if (!(await commandExists("volta"))) return new Map();
  const result = await capture("volta", ["list", "all"], options);
  if (result.exitCode !== 0) return new Map();
  const versions = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^package\s+(.+?)(?:@([^@\s]+))?$/);
    if (match) versions.set(nodePackageName(match[1]), match[2] ?? "installed");
  }
  return versions;
}

async function installedPnpmVersions(options: RunOptions): Promise<Map<string, string>> {
  const result = await capture("pnpm", ["list", "-g", "--depth=0", "--json"], options);
  if (result.exitCode !== 0 || !result.stdout.trim()) return new Map();
  const data = JSON.parse(result.stdout) as Array<{ dependencies?: Record<string, { version?: string }> }> | {
    dependencies?: Record<string, { version?: string }>;
  };
  const root = Array.isArray(data) ? data[0] : data;
  return dependencyVersions(root?.dependencies);
}

async function installedBunVersions(): Promise<Map<string, string>> {
  const root = process.env.BUN_INSTALL || join(homedir(), ".bun");
  try {
    const data = JSON.parse(await readFile(join(root, "install/global/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return new Map(Object.entries(data.dependencies ?? {}).map(([name, version]) => [name, normalizeVersion(version)]));
  } catch {
    return new Map();
  }
}

async function installedUvVersions(options: RunOptions): Promise<Map<string, string>> {
  const result = await capture("uv", ["tool", "list"], options);
  if (result.exitCode !== 0) return new Map();
  const versions = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^([^\s]+)\s+v?([^\s]+)/);
    if (match) versions.set(match[1], match[2]);
  }
  return versions;
}

async function latestVersion(command: "npm" | "pnpm", packageName: string, options: RunOptions): Promise<string | undefined> {
  const result = await capture(command, ["view", packageName, "version", "--json"], options);
  if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
  return String(JSON.parse(result.stdout)).trim();
}

async function latestBunVersion(packageName: string, options: RunOptions): Promise<string | undefined> {
  const result = await capture("bun", ["info", packageName, "version"], options);
  if (result.exitCode !== 0 || !result.stdout.trim()) return undefined;
  return result.stdout.trim().replace(/^"|"$/g, "");
}

function dependencyVersions(dependencies?: Record<string, { version?: string }>): Map<string, string> {
  return new Map(Object.entries(dependencies ?? {}).map(([name, value]) => [name, value.version ?? "installed"]));
}

function nodePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const versionIndex = spec.indexOf("@", 1);
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  }
  const versionIndex = spec.indexOf("@");
  return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
}

function pythonPackageName(spec: string): string {
  return spec.match(/^[A-Za-z0-9_.-]+/)?.[0] ?? spec;
}

function sameVersion(current: string, latest: string): boolean {
  if (current === "missing") return false;
  return normalizeVersion(current) === normalizeVersion(latest);
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^[~^=<>v\s]+/, "");
}
