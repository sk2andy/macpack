import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "@clack/prompts";
import { commandExists, runStep } from "../core/exec.js";
import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";

export async function applyBun(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (options.cleanup) await cleanupBun(manifest, options);
  if (manifest.bunPackages.length === 0) return;
  if (!(await commandExists("bun"))) throw new Error("bun is not installed. Run `macpack setup` first.");

  log.info(`bun: installing ${manifest.bunPackages.length} global packages`);
  await runStep("bun: installing global packages", "bun", ["install", "-g", ...manifest.bunPackages], options);
}

export async function cleanupBun(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  if (!(await commandExists("bun"))) return;
  const keep = new Set(manifest.bunPackages);
  for (const packageName of await installedBunPackages()) {
    if (!keep.has(packageName)) await runStep(`bun: removing ${packageName}`, "bun", ["remove", "-g", packageName], options);
  }
}

async function installedBunPackages(): Promise<string[]> {
  const root = process.env.BUN_INSTALL || join(homedir(), ".bun");
  const packageJson = join(root, "install/global/package.json");
  try {
    const data = JSON.parse(await readFile(packageJson, "utf8")) as { dependencies?: Record<string, unknown> };
    return Object.keys(data.dependencies ?? {});
  } catch {
    return [];
  }
}
