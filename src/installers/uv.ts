import { log } from "@clack/prompts";
import { capture, commandExists, run } from "../core/exec.js";
import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";

export async function applyUv(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (options.cleanup) await cleanupUv(manifest, options);
  if (manifest.uvTools.length === 0) return;
  if (!(await commandExists("uv"))) throw new Error("uv is not installed. Run `macpack setup` first.");

  for (const [index, tool] of manifest.uvTools.entries()) {
    log.info(`uv tool ${index + 1}/${manifest.uvTools.length}: ${tool.packageName} (${tool.python})`);
    await run("uv", ["tool", "install", "--upgrade", "-p", tool.python, tool.packageName], options);
  }
}

export async function cleanupUv(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  if (!(await commandExists("uv"))) return;
  const keep = new Set(manifest.uvTools.map((tool) => tool.packageName));
  for (const packageName of await installedUvTools()) {
    if (!keep.has(packageName)) await run("uv", ["tool", "uninstall", packageName], options);
  }
}

async function installedUvTools(): Promise<string[]> {
  const result = await capture("uv", ["tool", "list"]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[^\s-]+ v\d/.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter(Boolean);
}
