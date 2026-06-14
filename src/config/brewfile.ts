import type { PackageManifest } from "../core/types.js";

export function formatBrewfile(manifest: PackageManifest): string {
  const lines: string[] = [];

  for (const tap of manifest.taps) lines.push(`tap ${quote(tap)}`);
  for (const brew of manifest.brews) lines.push(`brew ${quote(brew)}`);
  for (const cask of manifest.casks) lines.push(`cask ${quote(cask)}`);
  for (const app of manifest.masApps) lines.push(`mas ${quote(app.name)}, id: ${app.id}`);

  return `${lines.join("\n")}\n`;
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
