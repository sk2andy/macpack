import { formatBrewfile } from "./brewfile.js";
import type { PackageManifest } from "../core/types.js";

export type ExportFormat = "manifest" | "brewfile" | "package-json" | "requirements-txt";

export interface ExportFilter {
  brew?: boolean;
  npm?: boolean;
  pnpm?: boolean;
  bun?: boolean;
  uv?: boolean;
  repos?: boolean;
}

export function hasFilter(filter: ExportFilter): boolean {
  return Object.values(filter).some(Boolean);
}

export function filterManifest(manifest: PackageManifest, filter: ExportFilter): PackageManifest {
  if (!hasFilter(filter)) return manifest;

  return {
    taps: filter.brew ? manifest.taps : [],
    brews: filter.brew ? manifest.brews : [],
    casks: filter.brew ? manifest.casks : [],
    masApps: filter.brew ? manifest.masApps : [],
    npmPackages: filter.npm ? manifest.npmPackages : [],
    pnpmPackages: filter.pnpm ? manifest.pnpmPackages : [],
    bunPackages: filter.bun ? manifest.bunPackages : [],
    uvTools: filter.uv ? manifest.uvTools : [],
    repos: filter.repos ? manifest.repos : [],
  };
}

export function formatExport(manifest: PackageManifest, format: ExportFormat): string {
  switch (format) {
    case "manifest":
      return formatManifest(manifest);
    case "brewfile":
      return formatBrewfile(manifest);
    case "package-json":
      return formatPackageJson(manifest);
    case "requirements-txt":
      return formatRequirementsTxt(manifest);
  }
}

export function formatManifest(manifest: PackageManifest): string {
  const lines: string[] = [];

  for (const tap of manifest.taps) lines.push(`tap ${quote(tap)}`);
  for (const brew of manifest.brews) lines.push(`brew ${quote(brew)}`);
  for (const cask of manifest.casks) lines.push(`cask ${quote(cask)}`);
  for (const app of manifest.masApps) lines.push(`mas ${quote(app.name)} ${quote(app.id)}`);
  for (const packageName of manifest.npmPackages) lines.push(`npm ${quote(packageName)}`);
  for (const packageName of manifest.pnpmPackages) lines.push(`pnpm ${quote(packageName)}`);
  for (const packageName of manifest.bunPackages) lines.push(`bun ${quote(packageName)}`);
  for (const tool of manifest.uvTools) lines.push(`uv ${quote(tool.python)} ${quote(tool.packageName)}`);
  for (const repo of manifest.repos) lines.push(`repo ${quote(repo.url)} ${quote(repo.targetDir)}`);

  return `${lines.join("\n")}\n`;
}

export function formatPackageJson(manifest: PackageManifest): string {
  const dependencies: Record<string, string> = {};

  for (const packageName of [...manifest.npmPackages, ...manifest.pnpmPackages, ...manifest.bunPackages]) {
    dependencies[packageName] = "latest";
  }

  return `${JSON.stringify({ dependencies }, null, 2)}\n`;
}

export function formatRequirementsTxt(manifest: PackageManifest): string {
  return `${manifest.uvTools.map((tool) => tool.packageName).join("\n")}\n`;
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
