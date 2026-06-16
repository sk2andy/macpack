import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { formatManifest } from "./exporters.js";
import { emptyManifest, parseManifest } from "./parser.js";
import type { GitRepo, MasApp, PackageManifest, UvTool } from "../core/types.js";

export type ManifestEntryKind = "tap" | "brew" | "cask" | "mas" | "npm" | "pnpm" | "bun" | "uv" | "repo";

export interface AddEntryOptions {
  python?: string;
  masId?: string;
}

export interface MutationResult {
  added?: number;
  removed?: number;
  removedRepos?: GitRepo[];
  path: string;
}

export async function addEntries(
  path: string,
  kind: ManifestEntryKind,
  values: string[],
  options: AddEntryOptions = {},
): Promise<MutationResult> {
  const manifest = await readManifestOrEmpty(path);
  const added = addToManifest(manifest, kind, values, options);
  await writeManifest(path, manifest);
  return { added, path };
}

export async function removeEntries(path: string, kind: ManifestEntryKind, values: string[]): Promise<MutationResult> {
  const manifest = await readManifestOrEmpty(path);
  const removeSet = new Set(values);
  const removedRepos = kind === "repo" ? manifest.repos.filter((repo) => removeSet.has(repo.targetDir) || removeSet.has(repo.url)) : [];
  const removed = removeFromManifest(manifest, kind, values);
  await writeManifest(path, manifest);
  return { removed, removedRepos, path };
}

export function addToManifest(
  manifest: PackageManifest,
  kind: ManifestEntryKind,
  values: string[],
  options: AddEntryOptions = {},
): number {
  if (values.length === 0) throw new Error(`${kind} requires at least one package`);

  switch (kind) {
    case "tap":
      return appendUnique(manifest.taps, values);
    case "brew":
      return appendUnique(manifest.brews, values);
    case "cask":
      return appendUnique(manifest.casks, values);
    case "npm":
      return appendUnique(manifest.npmPackages, values);
    case "pnpm":
      return appendUnique(manifest.pnpmPackages, values);
    case "bun":
      return appendUnique(manifest.bunPackages, values);
    case "uv":
      if (!options.python) throw new Error("uv entries require --python <version>");
      return appendUniqueUv(manifest.uvTools, values, options.python);
    case "mas":
      if (!options.masId) throw new Error("mas entries require --id <app-id>");
      if (values.length !== 1) throw new Error("mas add accepts one app name with --id");
      return appendUniqueMas(manifest.masApps, { name: values[0], id: options.masId });
    case "repo":
      if (values.length !== 2) throw new Error("repo add accepts one git URL and one target directory");
      return appendUniqueRepo(manifest.repos, { url: values[0], targetDir: values[1] });
  }
}

export function removeFromManifest(manifest: PackageManifest, kind: ManifestEntryKind, values: string[]): number {
  if (values.length === 0) throw new Error(`${kind} requires at least one package`);
  const removeSet = new Set(values);

  switch (kind) {
    case "tap":
      return removeFromArray(manifest.taps, removeSet);
    case "brew":
      return removeFromArray(manifest.brews, removeSet);
    case "cask":
      return removeFromArray(manifest.casks, removeSet);
    case "npm":
      return removeFromArray(manifest.npmPackages, removeSet);
    case "pnpm":
      return removeFromArray(manifest.pnpmPackages, removeSet);
    case "bun":
      return removeFromArray(manifest.bunPackages, removeSet);
    case "uv":
      return removeObjects(manifest.uvTools, (tool) => removeSet.has(tool.packageName));
    case "mas":
      return removeObjects(manifest.masApps, (app) => removeSet.has(app.id) || removeSet.has(app.name));
    case "repo":
      return removeObjects(manifest.repos, (repo) => removeSet.has(repo.targetDir) || removeSet.has(repo.url));
  }
}

async function readManifestOrEmpty(path: string): Promise<PackageManifest> {
  try {
    return parseManifest(await readFile(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyManifest();
    throw error;
  }
}

async function writeManifest(path: string, manifest: PackageManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatManifest(manifest), "utf8");
}

function appendUnique(target: string[], values: string[]): number {
  let added = 0;
  for (const value of values) {
    if (target.includes(value)) continue;
    target.push(value);
    added += 1;
  }
  return added;
}

function appendUniqueUv(target: UvTool[], packageNames: string[], python: string): number {
  let added = 0;
  for (const packageName of packageNames) {
    const existing = target.find((tool) => tool.packageName === packageName);
    if (existing) {
      existing.python = python;
      continue;
    }
    target.push({ python, packageName });
    added += 1;
  }
  return added;
}

function appendUniqueMas(target: MasApp[], app: MasApp): number {
  const existing = target.find((entry) => entry.id === app.id || entry.name === app.name);
  if (existing) {
    existing.name = app.name;
    existing.id = app.id;
    return 0;
  }
  target.push(app);
  return 1;
}

function appendUniqueRepo(target: GitRepo[], repo: GitRepo): number {
  const existing = target.find((entry) => entry.targetDir === repo.targetDir);
  if (existing) {
    existing.url = repo.url;
    return 0;
  }
  target.push(repo);
  return 1;
}

function removeFromArray(target: string[], removeSet: Set<string>): number {
  return removeObjects(target, (value) => removeSet.has(value));
}

function removeObjects<T>(target: T[], shouldRemove: (value: T) => boolean): number {
  const kept = target.filter((value) => !shouldRemove(value));
  const removed = target.length - kept.length;
  target.splice(0, target.length, ...kept);
  return removed;
}
