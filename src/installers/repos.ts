import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { log } from "@clack/prompts";
import { confirmOrCancel } from "../core/prompts.js";
import { capture, commandExists, runStep } from "../core/exec.js";
import type { ApplyOptions, GitRepo, RunOptions } from "../core/types.js";

export interface DeleteRepoOptions extends RunOptions {
  yes?: boolean;
}

export async function applyRepos(repos: GitRepo[], options: ApplyOptions = {}): Promise<void> {
  if (repos.length === 0) return;
  if (!options.dryRun && !(await commandExists("git"))) throw new Error("git is not installed. Run `macpack setup` first.");

  for (const [index, repo] of repos.entries()) {
    const targetDir = resolveUserPath(repo.targetDir);
    const label = `repo ${index + 1}/${repos.length}: ${repo.targetDir}`;

    if (await isGitRepository(targetDir)) {
      const actualUrl = await gitRemoteUrl(targetDir, options);
      if (actualUrl && actualUrl !== repo.url) {
        throw new Error(`Repo target ${targetDir} has origin ${actualUrl}, expected ${repo.url}`);
      }
      log.info(`${label}: already present`);
      continue;
    }

    if (await pathExists(targetDir)) {
      if (!(await isEmptyDirectory(targetDir))) {
        throw new Error(`Repo target exists and is not a git repository: ${targetDir}`);
      }
    } else if (!options.dryRun) {
      await mkdir(dirname(targetDir), { recursive: true });
    }

    await runStep(`${label}: cloning`, "git", ["clone", repo.url, targetDir], options);
  }
}

export async function deleteRepoTargets(repos: GitRepo[], options: DeleteRepoOptions = {}): Promise<void> {
  await validateRepoTargetsForDeletion(repos, options);

  for (const repo of repos) {
    const targetDir = resolveUserPath(repo.targetDir);
    if (!(await pathExists(targetDir))) {
      log.info(`repo delete: ${repo.targetDir} is already missing`);
      continue;
    }

    const shouldDelete = options.yes || (await confirmOrCancel(`Delete repo folder ${targetDir}?`, false));
    if (!shouldDelete) continue;

    if (options.dryRun) {
      log.info(`[dry-run] rm -rf ${targetDir}`);
      continue;
    }

    await rm(targetDir, { recursive: true, force: true });
    log.success(`Deleted ${targetDir}`);
  }
}

export async function validateRepoTargetsForDeletion(repos: GitRepo[], options: DeleteRepoOptions = {}): Promise<void> {
  if (!options.dryRun && repos.length > 0 && !(await commandExists("git"))) throw new Error("git is not installed. Run `macpack setup` first.");

  for (const repo of repos) {
    const targetDir = resolveUserPath(repo.targetDir);
    assertDeletablePath(targetDir);
    if (!(await pathExists(targetDir))) continue;
    if (!(await isGitRepository(targetDir))) {
      throw new Error(`Refusing to delete repo target that is not a git repository: ${targetDir}`);
    }
    const actualUrl = await gitRemoteUrl(targetDir, options);
    if (actualUrl !== repo.url) {
      throw new Error(`Refusing to delete ${targetDir}; origin ${actualUrl || "missing"} does not match ${repo.url}`);
    }
  }
}

export function resolveUserPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepository(path: string): Promise<boolean> {
  try {
    const result = await capture("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { quiet: true });
    return result.exitCode === 0 && result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function isEmptyDirectory(path: string): Promise<boolean> {
  const info = await stat(path);
  if (!info.isDirectory()) return false;
  return (await readdir(path)).length === 0;
}

function assertDeletablePath(path: string): void {
  const home = homedir();
  if (path === "/" || path === home || path === resolve(process.cwd())) {
    throw new Error(`Refusing to delete unsafe repo target: ${path}`);
  }
}

async function gitRemoteUrl(targetDir: string, options: RunOptions): Promise<string | undefined> {
  const result = await capture("git", ["-C", targetDir, "config", "--get", "remote.origin.url"], options);
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim() || undefined;
}
