import { spawn } from "node:child_process";
import { log, spinner } from "@clack/prompts";
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

export async function runStep(label: string, command: string, args: string[] = [], options: RunOptions = {}): Promise<void> {
  const rendered = [command, ...args].join(" ");
  if (options.dryRun) {
    log.info(`[dry-run] ${rendered}`);
    return;
  }

  if (options.verbose) {
    log.info(label);
    await run(command, args, options);
    return;
  }

  const s = spinner();
  s.start(label);
  let result: CommandResult;
  try {
    result = await capture(command, args, options);
  } catch (error) {
    s.stop(`${label} failed`);
    throw error;
  }
  const output = joinOutput(result.stdout, result.stderr);

  if (result.exitCode === 0) {
    s.stop(label);
    for (const warning of warningBlocks(output)) {
      log.warn(warning);
    }
    return;
  }

  s.stop(`${label} failed`);
  if (output) process.stderr.write(`${output}\n`);
  throw new Error(`${rendered} failed with exit code ${result.exitCode}`);
}

export async function captureStep(label: string, command: string, args: string[] = [], options: RunOptions = {}): Promise<CommandResult> {
  const rendered = [command, ...args].join(" ");
  if (options.dryRun) {
    log.info(`[dry-run] ${rendered}`);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (options.verbose) {
    log.info(label);
    const result = await capture(command, args, options);
    const output = joinOutput(result.stdout, result.stderr);
    if (output) process.stderr.write(`${output}\n`);
    return result;
  }

  const s = spinner();
  s.start(label);
  let result: CommandResult;
  try {
    result = await capture(command, args, options);
  } catch (error) {
    s.stop(`${label} failed`);
    throw error;
  }
  const output = joinOutput(result.stdout, result.stderr);
  s.stop(label);

  if (result.exitCode === 0) {
    for (const warning of warningBlocks(output)) {
      log.warn(warning);
    }
  }

  return result;
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

function joinOutput(stdout: string, stderr: string): string {
  return [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n");
}

function warningBlocks(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bwarning\b/i.test(lines[index])) continue;

    const block = [lines[index]];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (!line.trim()) break;
      if (/^(==>|[-+*]|\w[\w -]*:)/.test(line) && !/^\s/.test(line)) break;
      block.push(line);
      index = next;
    }
    blocks.push(block.join("\n"));
  }

  return blocks;
}
