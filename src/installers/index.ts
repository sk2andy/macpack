import type { ApplyOptions, CleanupOptions, PackageManifest } from "../core/types.js";
import { applyBrew, cleanupBrew, hasBrewEntries } from "./brew.js";
import { applyBun, cleanupBun } from "./bun.js";
import { applyNpm, cleanupNpm } from "./npm.js";
import { applyPnpm, cleanupPnpm } from "./pnpm.js";
import { applyUv, cleanupUv } from "./uv.js";

export async function applyAll(manifest: PackageManifest, options: ApplyOptions = {}): Promise<void> {
  if (hasBrewEntries(manifest)) await applyBrew(manifest, options);
  await applyNpm(manifest, options);
  await applyPnpm(manifest, options);
  await applyBun(manifest, options);
  await applyUv(manifest, options);
}

export async function cleanupAll(manifest: PackageManifest, options: CleanupOptions = {}): Promise<void> {
  if (hasBrewEntries(manifest)) await cleanupBrew(manifest, options);
  await cleanupNpm(manifest, options);
  await cleanupPnpm(manifest, options);
  await cleanupBun(manifest, options);
  await cleanupUv(manifest, options);
}
