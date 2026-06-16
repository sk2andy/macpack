import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectGitRepositories, parseMasList, parseUvToolList } from "./discovery.js";
import { formatBrewfile } from "./brewfile.js";
import { filterManifest, formatExport, formatPackageJson, formatRequirementsTxt } from "./exporters.js";
import { addToManifest, removeFromManifest } from "./mutate.js";
import { parseManifest } from "./parser.js";
import { manifestForManagers, selectedManagers } from "../upgrades/upgrade.js";
import { run } from "../core/exec.js";

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
      repo "git@github.com:sk2andy/macpack.git" "~/workspace/macpack"
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
      repos: [{ url: "git@github.com:sk2andy/macpack.git", targetDir: "~/workspace/macpack" }],
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
      repos: [],
    });
  });

  it("adds and removes manifest entries by kind", () => {
    const manifest = parseManifest(`
      brew "uv"
      npm "tsx"
      uv "3.13" "serena-agent"
      repo "git@github.com:sk2andy/macpack.git" "~/workspace/macpack"
    `);

    expect(addToManifest(manifest, "brew", ["gh", "uv"])).toBe(1);
    expect(addToManifest(manifest, "uv", ["serena-agent", "ruff==0.6.0"], { python: "3.14" })).toBe(1);
    expect(addToManifest(manifest, "repo", ["https://github.com/sk2andy/macpack.git", "~/workspace/macpack"])).toBe(0);
    expect(addToManifest(manifest, "repo", ["https://github.com/sk2andy/other.git", "~/workspace/other"])).toBe(1);
    expect(removeFromManifest(manifest, "npm", ["tsx"])).toBe(1);

    expect(manifest.brews).toEqual(["uv", "gh"]);
    expect(manifest.npmPackages).toEqual([]);
    expect(manifest.uvTools).toEqual([
      { python: "3.14", packageName: "serena-agent" },
      { python: "3.14", packageName: "ruff==0.6.0" },
    ]);
    expect(manifest.repos).toEqual([
      { url: "https://github.com/sk2andy/macpack.git", targetDir: "~/workspace/macpack" },
      { url: "https://github.com/sk2andy/other.git", targetDir: "~/workspace/other" },
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
      repos: [],
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

  it("collects git repositories while skipping worktree directories", async () => {
    const root = await mkdtempInTmp("macpack-repos-");
    const repo = join(root, "workspace", "macpack");
    const skippedRepo = join(root, "worktree-directories", "ignored");
    const skippedWorktreesRepo = join(root, ".codex", "worktrees", "ignored");
    const gitWorktree = join(root, "workspace", "feature-worktree");
    await initTestRepo(repo, "https://github.com/sk2andy/macpack.git");
    await initTestRepo(skippedRepo, "https://github.com/sk2andy/ignored.git");
    await initTestRepo(skippedWorktreesRepo, "https://github.com/sk2andy/worktrees-ignored.git");
    await initTestWorktree(gitWorktree);

    await expect(collectGitRepositories(root)).resolves.toEqual([
      { url: "https://github.com/sk2andy/macpack.git", targetDir: repo },
    ]);
  });
});

async function mkdtempInTmp(prefix: string): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), prefix));
}

async function initTestRepo(path: string, url: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await run("git", ["init"], { cwd: path, quiet: true });
  await run("git", ["remote", "add", "origin", url], { cwd: path, quiet: true });
}

async function initTestWorktree(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, ".git"), "gitdir: /tmp/macpack-worktree/.git/worktrees/feature\n", "utf8");
}
