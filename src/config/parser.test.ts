import { describe, expect, it } from "vitest";
import { parseMasList, parseUvToolList } from "./discovery.js";
import { formatBrewfile } from "./brewfile.js";
import { filterManifest, formatExport, formatPackageJson, formatRequirementsTxt } from "./exporters.js";
import { addToManifest, removeFromManifest } from "./mutate.js";
import { parseManifest } from "./parser.js";
import { manifestForManagers, selectedManagers } from "../upgrades/upgrade.js";

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

  it("adds and removes manifest entries by kind", () => {
    const manifest = parseManifest(`
      brew "uv"
      npm "tsx"
      uv "3.13" "serena-agent"
    `);

    expect(addToManifest(manifest, "brew", ["gh", "uv"])).toBe(1);
    expect(addToManifest(manifest, "uv", ["serena-agent", "ruff==0.6.0"], { python: "3.14" })).toBe(1);
    expect(removeFromManifest(manifest, "npm", ["tsx"])).toBe(1);

    expect(manifest.brews).toEqual(["uv", "gh"]);
    expect(manifest.npmPackages).toEqual([]);
    expect(manifest.uvTools).toEqual([
      { python: "3.14", packageName: "serena-agent" },
      { python: "3.14", packageName: "ruff==0.6.0" },
    ]);
  });

  it("selects manifest sections for upgrade managers", () => {
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

    expect(manifestForManagers(manifest, selectedManagers("brew"))).toEqual({
      taps: ["azure/functions"],
      brews: ["uv"],
      casks: ["postman"],
      masApps: [{ name: "Keynote", id: "409183694" }],
      npmPackages: [],
      pnpmPackages: [],
      bunPackages: [],
      uvTools: [],
    });
  });

  it("parses installed mas apps", () => {
    expect(parseMasList("409183694 Keynote (14.4)\n497799835 Xcode (26.1)\n")).toEqual([
      { id: "409183694", name: "Keynote" },
      { id: "497799835", name: "Xcode" },
    ]);
  });

  it("parses installed uv tools with a python fallback", () => {
    expect(
      parseUvToolList(
        `
          nano-pdf v0.2.1
          - nano-pdf
          serena-agent v1.5.3
          - serena
        `,
        "3.14",
      ),
    ).toEqual([
      { python: "3.14", packageName: "nano-pdf" },
      { python: "3.14", packageName: "serena-agent" },
    ]);
  });
});
