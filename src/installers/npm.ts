import { log } from "@clack/prompts";
import { capture, commandExists, run } from "../core/exec.js";
import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";

export async function applyNpm(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (options.cleanup) await cleanupNpm(manifest, options);
  if (manifest.npmPackages.length === 0) return;

  if (await commandExists("volta")) {
    for (const packageName of manifest.npmPackages) {
      log.info(`npm via Volta: installing ${packageName}`);
      await run("volta", ["install", packageName], options);
    }
    return;
  }

  if (!(await commandExists("npm"))) throw new Error("npm is not installed. Run `macpack setup` first.");
  log.info(`npm: installing ${manifest.npmPackages.length} global packages`);
  await run("npm", ["install", "-g", ...manifest.npmPackages], options);
}

export async function cleanupNpm(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  const keep = new Set(manifest.npmPackages);
  if (await commandExists("volta")) {
    for (const packageName of await installedVoltaPackages()) {
      if (!keep.has(packageName)) await run("volta", ["uninstall", packageName], options);
    }
  }
  if (await commandExists("npm")) {
    for (const packageName of await installedNpmPackages()) {
      if (!keep.has(packageName)) await run("npm", ["uninstall", "-g", packageName], options);
    }
  }
}

async function installedVoltaPackages(): Promise<string[]> {
  const result = await capture("volta", ["list", "all"]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package "))
    .map((line) => line.split(/\s+/)[1])
    .filter(Boolean)
    .map((spec) => spec.replace(/@[^@]*$/, ""));
}

async function installedNpmPackages(): Promise<string[]> {
  const result = await capture("npm", ["ls", "-g", "--depth=0", "--json"]);
  if (result.exitCode !== 0 && !result.stdout.trim()) return [];
  const data = JSON.parse(result.stdout || "{}") as { dependencies?: Record<string, unknown> };
  return Object.keys(data.dependencies ?? {});
}
