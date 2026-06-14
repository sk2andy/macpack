import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatManifest } from "./exporters.js";
import type { PackageManifest } from "../core/types.js";

export const DEFAULT_MANIFEST_NAME = "packages.macpack";

export function localManifestPath(): string {
  return resolve(process.cwd(), DEFAULT_MANIFEST_NAME);
}

export function configManifestPath(): string {
  return join(homedir(), ".config", "macpack", DEFAULT_MANIFEST_NAME);
}

export interface ManifestPathOptions {
  global?: boolean;
}

export async function resolveManifestPath(file?: string, options: ManifestPathOptions = {}): Promise<string> {
  if (file && options.global) throw new Error("Use either --file or --global, not both.");
  if (file) return resolve(file);
  if (options.global) {
    const config = configManifestPath();
    if (await pathExists(config)) return config;
    throw new Error(`Global manifest not found at ${config}. Run setup or use macpack add --global to create it.`);
  }
  const local = localManifestPath();
  if (await pathExists(local)) return local;
  const config = configManifestPath();
  if (await pathExists(config)) return config;
  throw new Error(`No manifest found. Run setup, pass --file, or create ${DEFAULT_MANIFEST_NAME}.`);
}

export async function ensureManifestFile(path: string): Promise<void> {
  if (await pathExists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
}

export async function writeManifestFile(path: string, manifest: PackageManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatManifest(manifest), "utf8");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
