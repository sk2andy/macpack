import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_MANIFEST_NAME = "packages.macpack";

export function localManifestPath(): string {
  return resolve(process.cwd(), DEFAULT_MANIFEST_NAME);
}

export function configManifestPath(): string {
  return join(homedir(), ".config", "macpack", DEFAULT_MANIFEST_NAME);
}

export async function resolveManifestPath(file?: string): Promise<string> {
  if (file) return resolve(file);
  const local = localManifestPath();
  if (await pathExists(local)) return local;
  return configManifestPath();
}

export async function ensureManifestFile(path: string): Promise<void> {
  if (await pathExists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "", "utf8");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
