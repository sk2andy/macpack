import { log } from "@clack/prompts";
import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";
import { applyBrew, cleanupBrew, hasBrewEntries } from "./brew.js";
import { applyBun, cleanupBun } from "./bun.js";
import { applyNpm, cleanupNpm } from "./npm.js";
import { applyPnpm, cleanupPnpm } from "./pnpm.js";
import { applyRepos } from "./repos.js";
import { applyUv, cleanupUv } from "./uv.js";

export type ApplyManager = "brew" | "npm" | "pnpm" | "bun" | "uv" | "repos";

const applyManagers: ApplyManager[] = ["brew", "npm", "pnpm", "bun", "uv", "repos"];

export function selectedApplyManagers(manager?: string): Set<ApplyManager> {
  if (!manager || manager === "all") return new Set(applyManagers);
  if (manager === "homebrew") return new Set(["brew"]);
  if (manager === "repo") return new Set(["repos"]);
  if (applyManagers.includes(manager as ApplyManager)) return new Set([manager as ApplyManager]);
  throw new Error(`Unsupported apply manager "${manager}". Use brew, npm, pnpm, bun, uv, repos, or all.`);
}

export function manifestForApplyManagers(manifest: PackageManifest, managers: Set<ApplyManager>): PackageManifest {
  return {
    taps: managers.has("brew") ? manifest.taps : [],
    brews: managers.has("brew") ? manifest.brews : [],
    casks: managers.has("brew") ? manifest.casks : [],
    masApps: managers.has("brew") ? manifest.masApps : [],
    npmPackages: managers.has("npm") ? manifest.npmPackages : [],
    pnpmPackages: managers.has("pnpm") ? manifest.pnpmPackages : [],
    bunPackages: managers.has("bun") ? manifest.bunPackages : [],
    uvTools: managers.has("uv") ? manifest.uvTools : [],
    repos: managers.has("repos") ? manifest.repos : [],
  };
}

export async function applyAll(
  manifest: PackageManifest,
  options: ApplyOptions = {},
  managers: Set<ApplyManager> = selectedApplyManagers(),
): Promise<void> {
  if (managers.has("brew") && hasBrewEntries(manifest)) {
    log.info(summary("Homebrew", [
      ["taps", manifest.taps.length],
      ["brews", manifest.brews.length],
      ["casks", manifest.casks.length],
      ["mas", manifest.masApps.length],
    ]));
    await applyBrew(manifest, options);
  }
  if (managers.has("npm") && manifest.npmPackages.length > 0) {
    log.info(summary("npm", [["packages", manifest.npmPackages.length]]));
  }
  if (managers.has("npm")) await applyNpm(manifest, options);
  if (managers.has("pnpm") && manifest.pnpmPackages.length > 0) {
    log.info(summary("pnpm", [["packages", manifest.pnpmPackages.length]]));
  }
  if (managers.has("pnpm")) await applyPnpm(manifest, options);
  if (managers.has("bun") && manifest.bunPackages.length > 0) {
    log.info(summary("bun", [["packages", manifest.bunPackages.length]]));
  }
  if (managers.has("bun")) await applyBun(manifest, options);
  if (managers.has("uv") && manifest.uvTools.length > 0) {
    log.info(summary("uv", [["tools", manifest.uvTools.length]]));
  }
  if (managers.has("uv")) await applyUv(manifest, options);
  if (managers.has("repos") && manifest.repos.length > 0) {
    log.info(summary("repos", [["repositories", manifest.repos.length]]));
    await applyRepos(manifest.repos, options);
  }
}

export async function cleanupAll(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  if (hasBrewEntries(manifest)) {
    log.info("Homebrew cleanup");
    await cleanupBrew(manifest, options);
  }
  if (manifest.npmPackages.length > 0) log.info("npm cleanup");
  await cleanupNpm(manifest, options);
  if (manifest.pnpmPackages.length > 0) log.info("pnpm cleanup");
  await cleanupPnpm(manifest, options);
  if (manifest.bunPackages.length > 0) log.info("bun cleanup");
  await cleanupBun(manifest, options);
  if (manifest.uvTools.length > 0) log.info("uv cleanup");
  await cleanupUv(manifest, options);
}

function summary(name: string, parts: Array<[string, number]>): string {
  return `${name}: ${parts.map(([label, count]) => `${count} ${label}`).join(", ")}`;
}
