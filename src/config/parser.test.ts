import { describe, expect, it } from "vitest";
import { formatBrewfile } from "./brewfile.js";
import { filterManifest, formatExport, formatPackageJson, formatRequirementsTxt } from "./exporters.js";
import { parseManifest } from "./parser.js";

describe("parseManifest", () => {
  it("parses all supported package kinds", () => {
    const manifest = parseManifest(`
      tap "azure/functions"
      brew "uv"
      cask "postman"
      mas "Keynote" "409183694"
      npm "tsx"
      pnpm "serve"
      bun "@johnlindquist/worktree"
      uv "3.14" "serena-agent"
    `);

    expect(manifest).toEqual({
      taps: ["azure/functions"],
      brews: ["uv"],
      casks: ["postman"],
      masApps: [{ name: "Keynote", id: "409183694" }],
      npmPackages: ["tsx"],
      pnpmPackages: ["serve"],
      bunPackages: ["@johnlindquist/worktree"],
      uvTools: [{ python: "3.14", packageName: "serena-agent" }],
    });
  });

  it("ignores comments outside quoted strings", () => {
    const manifest = parseManifest('brew "foo#bar" # keep comment out');
    expect(manifest.brews).toEqual(["foo#bar"]);
  });

  it("formats only homebrew entries into a Brewfile", () => {
    const manifest = parseManifest(`
      tap "azure/functions"
      brew "uv"
      npm "tsx"
      uv "3.14" "serena-agent"
    `);

    expect(formatBrewfile(manifest)).toBe('tap "azure/functions"\nbrew "uv"\n');
  });

  it("exports node packages as package.json dependencies", () => {
    const manifest = parseManifest(`
      npm "tsx"
      pnpm "serve"
      bun "@johnlindquist/worktree"
      uv "3.14" "serena-agent"
    `);

    expect(formatPackageJson(manifest)).toBe(
      `${JSON.stringify(
        {
          dependencies: {
            tsx: "latest",
            serve: "latest",
            "@johnlindquist/worktree": "latest",
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("exports uv tools as requirements.txt package names", () => {
    const manifest = parseManifest(`
      uv "3.14" "nano-pdf"
      uv "3.14" "serena-agent"
    `);

    expect(formatRequirementsTxt(manifest)).toBe("nano-pdf\nserena-agent\n");
  });

  it("filters sections before exporting", () => {
    const manifest = parseManifest(`
      brew "uv"
      npm "tsx"
      uv "3.14" "serena-agent"
    `);

    expect(filterManifest(manifest, { uv: true })).toEqual({
      taps: [],
      brews: [],
      casks: [],
      masApps: [],
      npmPackages: [],
      pnpmPackages: [],
      bunPackages: [],
      uvTools: [{ python: "3.14", packageName: "serena-agent" }],
    });
  });
});
