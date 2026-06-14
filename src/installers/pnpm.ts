import { capture, commandExists, run } from "../core/exec.js";
import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";

export async function applyPnpm(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (options.cleanup) await cleanupPnpm(manifest, options);
  if (manifest.pnpmPackages.length === 0) return;
  if (!(await commandExists("pnpm"))) throw new Error("pnpm is not installed. Add `npm \"pnpm\"` or run setup.");

  await run("pnpm", ["add", "-g", ...manifest.pnpmPackages], options);
}

export async function cleanupPnpm(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  if (!(await commandExists("pnpm"))) return;
  const keep = new Set(manifest.pnpmPackages);
  for (const packageName of await installedPnpmPackages()) {
    if (!keep.has(packageName)) await run("pnpm", ["remove", "-g", packageName], options);
  }
}

async function installedPnpmPackages(): Promise<string[]> {
  const result = await capture("pnpm", ["list", "-g", "--depth=0", "--json"]);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return [];
  }

  const data = JSON.parse(result.stdout) as Array<{ dependencies?: Record<string, unknown> }> | { dependencies?: Record<string, unknown> };
  const root = Array.isArray(data) ? data[0] : data;
  return Object.keys(root?.dependencies ?? {});
}
