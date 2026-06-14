import { spawn } from "node:child_process";
import type { CommandResult, RunOptions } from "./types.js";

export async function run(command: string, args: string[] = [], options: RunOptions = {}): Promise<void> {
  const rendered = [command, ...args].join(" ");
  if (options.dryRun) {
    console.log(`[dry-run] ${rendered}`);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: options.quiet ? "pipe" : "inherit",
    });

    let stderr = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${rendered} failed with exit code ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

export async function capture(command: string, args: string[] = [], options: RunOptions = {}): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await capture("sh", ["-lc", `command -v ${shellEscape(command)}`]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
