import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageManifest } from "../core/types.js";

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  captureStep: vi.fn(),
  commandExists: vi.fn(),
  runStep: vi.fn(),
}));

vi.mock("../core/exec.js", () => execMocks);

import { applyBrew } from "./brew.js";

describe("applyBrew", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("installs formulae, casks, and MAS apps as individual progress steps", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "xcode-select") return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"casks":[{"name":"postman"}]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "postman 11.0\n", stderr: "", exitCode: 0 };
      if (command === "mas" && args[0] === "list") return { stdout: "409183694 Keynote (14.4)\n", stderr: "", exitCode: 0 };
      if (command === "mas" && args[0] === "outdated") return { stdout: "409183694 Keynote (14.4 -> 14.5)\n", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    execMocks.captureStep.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await applyBrew(manifest({
      brews: ["gh", "jq"],
      casks: ["postman"],
      masApps: [{ name: "Keynote", id: "409183694" }],
    }));

    expect(execMocks.runStep.mock.calls).toEqual([
      ["Homebrew brew 1/2: gh", "brew", ["install", "--formula", "gh"], expect.any(Object)],
      ["Homebrew brew 2/2: jq", "brew", ["install", "--formula", "jq"], expect.any(Object)],
      ["Homebrew MAS 1/1: Keynote: updating", "mas", ["update", "409183694"], expect.any(Object)],
    ]);
    expect(execMocks.captureStep).toHaveBeenCalledWith(
      "Homebrew cask 1/1: postman: updating",
      "brew",
      ["upgrade", "--cask", "postman"],
      expect.any(Object),
    );
    expect([...execMocks.runStep.mock.calls, ...execMocks.captureStep.mock.calls].flat()).not.toContain("bundle");
  });

  it("uses no brew bundle when manifest contains only formulae", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockResolvedValue({ stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 });

    await applyBrew(manifest({ brews: ["gh"] }));

    expect(execMocks.runStep).toHaveBeenCalledOnce();
    expect(execMocks.runStep).toHaveBeenCalledWith(
      "Homebrew brew 1/1: gh",
      "brew",
      ["install", "--formula", "gh"],
      expect.any(Object),
    );
    expect(execMocks.captureStep).not.toHaveBeenCalled();
  });

  it("reports the cask that failed", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"casks":[{"name":"codexbar"}]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "codexbar 0.41.0\n", stderr: "", exitCode: 0 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });
    execMocks.captureStep.mockResolvedValue({ stdout: "", stderr: "Swift toolchain mismatch", exitCode: 1 });

    await expect(applyBrew(manifest({ casks: ["codexbar"] }))).rejects.toThrow(
      "brew upgrade --cask codexbar failed with exit code 1\nSwift toolchain mismatch",
    );
  });

  it("does not reinstall casks that are already up to date", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"casks":[]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "postman 11.0\n", stderr: "", exitCode: 0 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ casks: ["postman"] }));

    expect(execMocks.captureStep).not.toHaveBeenCalled();
  });

  it("skips MAS apps that are already up to date", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "mas" && args[0] === "list") return { stdout: "409183694 Keynote (14.4)\n", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ masApps: [{ name: "Keynote", id: "409183694" }] }));

    expect(execMocks.runStep).not.toHaveBeenCalled();
    expect(execMocks.captureStep).not.toHaveBeenCalled();
  });

  it("falls back to mas get when mas install fails", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    execMocks.captureStep
      .mockResolvedValueOnce({ stdout: "", stderr: "not purchased", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await applyBrew(manifest({ masApps: [{ name: "Keynote", id: "409183694" }] }));

    expect(execMocks.captureStep.mock.calls).toEqual([
      ["Homebrew MAS 1/1: Keynote: installing", "mas", ["install", "409183694"], expect.any(Object)],
      ["Homebrew MAS 1/1: Keynote: getting", "mas", ["get", "409183694"], expect.any(Object)],
    ]);
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
