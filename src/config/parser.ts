import { readFile } from "node:fs/promises";
import type { PackageManifest } from "../core/types.js";

export function emptyManifest(): PackageManifest {
  return {
    taps: [],
    brews: [],
    casks: [],
    masApps: [],
    npmPackages: [],
    pnpmPackages: [],
    bunPackages: [],
    uvTools: [],
  };
}

export async function parseManifestFile(path: string): Promise<PackageManifest> {
  return parseManifest(await readFile(path, "utf8"), path);
}

export function parseManifest(source: string, label = "manifest"): PackageManifest {
  const manifest = emptyManifest();
  const lines = source.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const match = line.match(/^([a-z][a-z0-9-]*)\s*(.*)$/i);
    if (!match) {
      throw new Error(`${label}:${lineNumber}: invalid manifest line`);
    }

    const [, command, rest] = match;
    const args = parseArgs(rest.trim(), `${label}:${lineNumber}`);
    addEntry(manifest, command, args, `${label}:${lineNumber}`);
  }

  return manifest;
}

function addEntry(manifest: PackageManifest, command: string, args: string[], location: string): void {
  switch (command) {
    case "tap":
      expectArgs(command, args, 1, location);
      manifest.taps.push(args[0]);
      break;
    case "brew":
      expectArgs(command, args, 1, location);
      manifest.brews.push(args[0]);
      break;
    case "cask":
      expectArgs(command, args, 1, location);
      manifest.casks.push(args[0]);
      break;
    case "mas":
      expectArgs(command, args, 2, location);
      manifest.masApps.push({ name: args[0], id: args[1] });
      break;
    case "npm":
      expectArgs(command, args, 1, location);
      manifest.npmPackages.push(args[0]);
      break;
    case "pnpm":
      expectArgs(command, args, 1, location);
      manifest.pnpmPackages.push(args[0]);
      break;
    case "bun":
      expectArgs(command, args, 1, location);
      manifest.bunPackages.push(args[0]);
      break;
    case "uv":
      expectArgs(command, args, 2, location);
      manifest.uvTools.push({ python: args[0], packageName: args[1] });
      break;
    default:
      throw new Error(`${location}: unsupported command "${command}"`);
  }
}

function expectArgs(command: string, args: string[], count: number, location: string): void {
  if (args.length !== count) {
    throw new Error(`${location}: ${command} expects ${count} argument(s), got ${args.length}`);
  }
}

function stripComment(line: string): string {
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#") {
      return line.slice(0, index);
    }
  }

  return line;
}

function parseArgs(input: string, location: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let hasToken = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      current += char;
      escaped = false;
      hasToken = true;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      hasToken = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      hasToken = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (escaped) {
    throw new Error(`${location}: dangling escape`);
  }
  if (quote) {
    throw new Error(`${location}: unterminated quote`);
  }
  if (hasToken) {
    args.push(current);
  }

  return args;
}
