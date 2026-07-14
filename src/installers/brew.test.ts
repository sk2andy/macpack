import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageManifest } from "../core/types.js";

const execMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  captureStep: vi.fn(),
  commandExists: vi.fn(),
  runStep: vi.fn(),
}));
const promptMocks = vi.hoisted(() => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../core/exec.js", () => execMocks);
vi.mock("@clack/prompts", () => promptMocks);

import { applyBrew } from "./brew.js";

describe("applyBrew", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("installs formulae, casks, and MAS apps as individual progress steps", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "xcode-select") return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "outdated" && args[1] === "--formula") return { stdout: '{"formulae":[]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "outdated" && args[1] === "--cask") return { stdout: '{"casks":[{"name":"postman"}]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list" && args[1] === "--formula") return { stdout: "", stderr: "", exitCode: 1 };
      if (command === "brew" && args[0] === "list" && args[1] === "--cask") return { stdout: "postman 11.0\n", stderr: "", exitCode: 0 };
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
      ["Homebrew brew 1/2: gh: installing", "brew", ["install", "--formula", "gh"], expect.any(Object)],
      ["Homebrew brew 2/2: jq: installing", "brew", ["install", "--formula", "jq"], expect.any(Object)],
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
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"formulae":[]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "", stderr: "", exitCode: 1 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ brews: ["gh"] }));

    expect(execMocks.runStep).toHaveBeenCalledOnce();
    expect(execMocks.runStep).toHaveBeenCalledWith(
      "Homebrew brew 1/1: gh: installing",
      "brew",
      ["install", "--formula", "gh"],
      expect.any(Object),
    );
    expect(execMocks.captureStep).not.toHaveBeenCalled();
  });

  it("shows up-to-date formulae as successful without running brew install", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"formulae":[]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "act 0.2.89\n", stderr: "", exitCode: 0 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ brews: ["act"] }));

    expect(execMocks.runStep).not.toHaveBeenCalled();
    expect(promptMocks.log.success).toHaveBeenCalledWith("Homebrew brew 1/1: act (up to date)");
    expect(promptMocks.log.warn).not.toHaveBeenCalled();
  });

  it("upgrades outdated formulae as named progress steps", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"formulae":[{"name":"act"}]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "act 0.2.88\n", stderr: "", exitCode: 0 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ brews: ["act"] }));

    expect(execMocks.runStep).toHaveBeenCalledWith(
      "Homebrew brew 1/1: act: updating",
      "brew",
      ["upgrade", "--formula", "act"],
      expect.any(Object),
    );
  });

  it("matches tap-qualified formulae against Homebrew outdated names", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"formulae":[{"name":"bun"}]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "bun 1.3.13\n", stderr: "", exitCode: 0 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ brews: ["oven-sh/bun/bun"] }));

    expect(execMocks.runStep).toHaveBeenCalledWith(
      "Homebrew brew 1/1: oven-sh/bun/bun: updating",
      "brew",
      ["upgrade", "--formula", "oven-sh/bun/bun"],
      expect.any(Object),
    );
  });

  it("matches formula aliases against canonical Homebrew names", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "brew" && args[0] === "outdated") return { stdout: '{"formulae":[{"name":"go"}]}', stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "list") return { stdout: "go 1.26.0\n", stderr: "", exitCode: 0 };
      return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ brews: ["golang"] }));

    expect(execMocks.runStep).toHaveBeenCalledWith(
      "Homebrew brew 1/1: golang: updating",
      "brew",
      ["upgrade", "--formula", "golang"],
      expect.any(Object),
    );
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
    expect(promptMocks.log.success).toHaveBeenCalledWith("Homebrew cask 1/1: postman (up to date)");
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
    expect(promptMocks.log.success).toHaveBeenCalledWith("Homebrew MAS 1/1: Keynote (up to date)");
  });

  it("shows installed taps as successful without duplicate progress", async () => {
    execMocks.commandExists.mockResolvedValue(true);
    execMocks.capture.mockImplementation(async (command: string, args: string[]) => {
      if (command === "xcode-select") return { stdout: "/Applications/Xcode.app/Contents/Developer\n", stderr: "", exitCode: 0 };
      if (command === "brew" && args[0] === "tap-info") {
        return { stdout: '[{"installed": true, "official": true}]', stderr: "", exitCode: 0 };
      }
      return { stdout: "[]", stderr: "", exitCode: 0 };
    });

    await applyBrew(manifest({ taps: ["oven-sh/bun"] }));

    expect(execMocks.runStep).not.toHaveBeenCalled();
    expect(promptMocks.log.success).toHaveBeenCalledWith("Homebrew tap 1/1: oven-sh/bun (up to date)");
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
