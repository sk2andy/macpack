import { log } from "@clack/prompts";
import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";
import { applyBrew, cleanupBrew, hasBrewEntries } from "./brew.js";
import { applyBun, cleanupBun } from "./bun.js";
import { applyNpm, cleanupNpm } from "./npm.js";
import { applyPnpm, cleanupPnpm } from "./pnpm.js";
import { applyRepos } from "./repos.js";
import { applyUv, cleanupUv } from "./uv.js";

export async function applyAll(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (hasBrewEntries(manifest)) {
    log.info(summary("Homebrew", [
      ["taps", manifest.taps.length],
      ["brews", manifest.brews.length],
      ["casks", manifest.casks.length],
      ["mas", manifest.masApps.length],
    ]));
    await applyBrew(manifest, options);
  }
  if (manifest.npmPackages.length > 0) {
    log.info(summary("npm", [["packages", manifest.npmPackages.length]]));
  }
  await applyNpm(manifest, options);
  if (manifest.pnpmPackages.length > 0) {
    log.info(summary("pnpm", [["packages", manifest.pnpmPackages.length]]));
  }
  await applyPnpm(manifest, options);
  if (manifest.bunPackages.length > 0) {
    log.info(summary("bun", [["packages", manifest.bunPackages.length]]));
  }
  await applyBun(manifest, options);
  if (manifest.uvTools.length > 0) {
    log.info(summary("uv", [["tools", manifest.uvTools.length]]));
  }
  await applyUv(manifest, options);
  if (manifest.repos.length > 0) {
    log.info(summary("repos", [["repositories", manifest.repos.length]]));
  }
  await applyRepos(manifest.repos, options);
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
