import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageManifest } from "../core/types.js";

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  commandExists: vi.fn(),
  runStep: vi.fn(),
}));
const promptMocks = vi.hoisted(() => ({
  log: { info: vi.fn() },
}));

vi.mock("../core/exec.js", () => execMocks);
vi.mock("@clack/prompts", () => promptMocks);

import { applyBun } from "./bun.js";
import { applyNpm } from "./npm.js";
import { applyPnpm } from "./pnpm.js";
import { applyUv } from "./uv.js";

describe("package-manager progress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    execMocks.commandExists.mockResolvedValue(true);
  });

  it("lets runStep own npm via Volta progress output", async () => {
    await applyNpm(manifest({ npmPackages: ["tsx", "vercel"] }));

    expect(execMocks.runStep.mock.calls).toEqual([
      ["npm via Volta: installing tsx", "volta", ["install", "tsx"], {}],
      ["npm via Volta: installing vercel", "volta", ["install", "vercel"], {}],
    ]);
    expect(promptMocks.log.info).not.toHaveBeenCalled();
  });

  it.each([
    ["pnpm", () => applyPnpm(manifest({ pnpmPackages: ["tsx"] })), "pnpm: installing global packages"],
    ["bun", () => applyBun(manifest({ bunPackages: ["tsx"] })), "bun: installing global packages"],
    ["uv", () => applyUv(manifest({ uvTools: [{ packageName: "mlx", python: "3.14" }] })), "uv tool 1/1: mlx"],
  ])("lets runStep own %s progress output", async (_manager, apply, label) => {
    await apply();

    expect(execMocks.runStep).toHaveBeenCalledOnce();
    expect(execMocks.runStep.mock.calls[0][0]).toBe(label);
    expect(promptMocks.log.info).not.toHaveBeenCalled();
  });
});

function manifest(overrides: Partial<PackageManifest>): PackageManifest {
  return {
    taps: [],
    brews: [],
    casks: [],
    masApps: [],
    npmPackages: [],
    pnpmPackages: [],
    bunPackages: [],
    uvTools: [],
    repos: [],
    ...overrides,
  };
}
