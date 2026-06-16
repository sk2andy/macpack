import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { intro, isCancel, log, multiselect, outro, cancel } from "@clack/prompts";
import { Command } from "commander";
import { configManifestPath, ensureManifestFile, localManifestPath, pathExists, resolveManifestPath } from "../config/defaults.js";
import { filterManifest, formatExport, type ExportFilter, type ExportFormat } from "../config/exporters.js";
import { addEntries, removeEntries, type ManifestEntryKind } from "../config/mutate.js";
import { parseManifestFile } from "../config/parser.js";
import { commandExists, capture, run, shellEscape } from "../core/exec.js";
import { assertMacOS, isMacOS } from "../core/platform.js";
import { applyAll, cleanupAll } from "../installers/index.js";
import { doctorBrew } from "../installers/brew.js";
import { deleteRepoTargets, validateRepoTargetsForDeletion } from "../installers/repos.js";
import { runSetup } from "../setup/setup.js";
import {
  applyUpgradeCandidates,
  collectUpgradeCandidates,
  manifestForManagers,
  selectedManagers,
  type UpgradeCandidate,
} from "../upgrades/upgrade.js";
import { VERSION } from "../version.js";

interface FileOptions {
  file?: string;
  global?: boolean;
}

interface MutatingOptions extends FileOptions {
  dryRun?: boolean;
  cleanup?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

interface ExportOptions extends FileOptions {
  output?: string;
  onlyBrew?: boolean;
  onlyNpm?: boolean;
  onlyPnpm?: boolean;
  onlyBun?: boolean;
  onlyUv?: boolean;
  brewfile?: boolean;
  packageJson?: boolean;
  requirementsTxt?: boolean;
  manifest?: boolean;
  onlyRepos?: boolean;
}

interface ListOptions extends FileOptions {
  onlyBrew?: boolean;
  onlyNpm?: boolean;
  onlyPnpm?: boolean;
  onlyBun?: boolean;
  onlyUv?: boolean;
  onlyRepos?: boolean;
}

interface AddOptions extends FileOptions {
  python?: string;
  id?: string;
}

interface RemoveOptions extends FileOptions {
  delete?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

interface UpgradeOptions extends FileOptions {
  all?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("macpack")
    .description("Universal macOS package manager for Homebrew, npm, pnpm, bun, uv, and git repositories.")
    .version(VERSION);

  program
    .command("setup")
    .description("Interactive macOS bootstrap for Homebrew, Node.js, bun, Python, and uv.")
    .option("-n, --dry-run", "Print install commands without running them")
    .action(async (options: { dryRun?: boolean }) => {
      await runSetup({ dryRun: options.dryRun });
    });

  program
    .command("apply")
    .description("Install/update all packages from a manifest.")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .option("--cleanup", "Remove installed tools not present in manifest")
    .option("-y, --yes", "Answer yes to trust prompts")
    .option("-n, --dry-run", "Print commands without running them")
    .option("-v, --verbose", "Stream command output instead of collapsing successful steps")
    .action(async (options: MutatingOptions) => {
      assertMacOS();
      intro("macpack apply");
      const file = await resolveManifestPath(options.file, { global: options.global });
      const manifest = await parseManifestFile(file);
      await applyAll(manifest, {
        cleanup: options.cleanup,
        dryRun: options.dryRun,
        yes: options.yes,
        verbose: options.verbose,
      });
      outro("Apply complete.");
    });

  program
    .command("cleanup")
    .description("Remove installed global packages/tools not present in manifest.")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .option("-y, --yes", "Assume yes where a prompt is needed")
    .option("-n, --dry-run", "Print commands without running them")
    .option("-v, --verbose", "Stream command output instead of collapsing successful steps")
    .action(async (options: MutatingOptions) => {
      assertMacOS();
      intro("macpack cleanup");
      const file = await resolveManifestPath(options.file, { global: options.global });
      const manifest = await parseManifestFile(file);
      await cleanupAll(manifest, {
        dryRun: options.dryRun,
        yes: options.yes,
        verbose: options.verbose,
      });
      outro("Cleanup complete.");
    });

  program
    .command("add")
    .description("Add entries to a manifest.")
    .argument("<kind>", "tap, brew, cask, mas, npm, pnpm, bun, uv, or repo")
    .argument("<packages...>", "Package names, uv specs, repo URL plus target dir, or one mas app name")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use or create the global config manifest")
    .option("-p, --python <version>", "Python version for uv entries")
    .option("-i, --id <app-id>", "Mac App Store app id for mas entries")
    .action(async (kind: ManifestEntryKind, packages: string[], options: AddOptions) => {
      const file = await resolveWritableManifestPath(options.file, { global: options.global });
      const result = await addEntries(file, normalizeKind(kind), packages, {
        python: options.python,
        masId: options.id,
      });
      log.success(`Added ${result.added ?? 0} entr${result.added === 1 ? "y" : "ies"} to ${result.path}`);
    });

  program
    .command("remove")
    .alias("rm")
    .description("Remove entries from a manifest.")
    .argument("<kind>", "tap, brew, cask, mas, npm, pnpm, bun, uv, or repo")
    .argument("<packages...>", "Package names, uv package names, mas ids/names, or repo target directories")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .option("--delete", "For repo entries, delete the target folder too")
    .option("-n, --dry-run", "Print delete commands without deleting folders")
    .option("-y, --yes", "Skip delete confirmation prompts")
    .action(async (kind: ManifestEntryKind, packages: string[], options: RemoveOptions) => {
      const normalizedKind = normalizeKind(kind);
      if (options.delete && normalizedKind !== "repo") throw new Error("--delete is only supported for repo entries.");
      const file = await resolveManifestPath(options.file, { global: options.global });
      const reposToDelete =
        options.delete && normalizedKind === "repo" ? reposMatchingValues((await parseManifestFile(file)).repos, packages) : [];
      if (options.delete) {
        await validateRepoTargetsForDeletion(reposToDelete, {
          dryRun: options.dryRun,
          yes: options.yes,
        });
      }
      const result = await removeEntries(file, normalizedKind, packages);
      if (options.delete) {
        await deleteRepoTargets(reposToDelete, {
          dryRun: options.dryRun,
          yes: options.yes,
        });
      }
      log.success(`Removed ${result.removed ?? 0} entr${result.removed === 1 ? "y" : "ies"} from ${result.path}`);
    });

  program
    .command("list")
    .alias("ls")
    .description("List manifest entries.")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .option("--only-brew", "Only include Homebrew tap/brew/cask/mas entries")
    .option("--only-npm", "Only include npm entries")
    .option("--only-pnpm", "Only include pnpm entries")
    .option("--only-bun", "Only include bun entries")
    .option("--only-uv", "Only include uv entries")
    .option("--only-repos", "Only include git repository entries")
    .action(async (options: ListOptions) => {
      const file = await resolveManifestPath(options.file, { global: options.global });
      const manifest = await parseManifestFile(file);
      const filtered = filterManifest(manifest, exportFilter(options));
      process.stdout.write(formatExport(filtered, "manifest"));
    });

  program
    .command("edit")
    .description("Open the manifest in the default editor.")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use or create the global config manifest")
    .action(async (options: FileOptions) => {
      const file = await resolveWritableManifestPath(options.file, { global: options.global });
      await ensureManifestFile(file);
      log.info(`Opening ${file}`);
      await openEditor(file);
    });

  program
    .command("upgrade")
    .description("Find and install newer versions for manifest entries.")
    .argument("[manager]", "brew, npm, pnpm, bun, uv, or all", "all")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .option("-a, --all", "Upgrade/install all matching manifest entries without prompting")
    .option("-y, --yes", "Answer yes to trust prompts")
    .option("-n, --dry-run", "Print commands without running them")
    .option("-v, --verbose", "Stream command output instead of collapsing successful steps")
    .action(async (manager: string, options: UpgradeOptions) => {
      assertMacOS();
      intro("macpack upgrade");
      const file = await resolveManifestPath(options.file, { global: options.global });
      const manifest = await parseManifestFile(file);
      const managers = selectedManagers(manager);

      if (options.all) {
        await applyAll(manifestForManagers(manifest, managers), {
          dryRun: options.dryRun,
          yes: options.yes,
          verbose: options.verbose,
        });
        outro("Upgrade complete.");
        return;
      }

      const candidates = await collectUpgradeCandidates(manifest, managers, { dryRun: options.dryRun });
      if (candidates.length === 0) {
        outro("No upgrades found.");
        return;
      }

      const selected = await selectUpgradeCandidates(candidates);
      if (selected.length === 0) {
        outro("No upgrades selected.");
        return;
      }

      await applyUpgradeCandidates(selected, {
        dryRun: options.dryRun,
        yes: options.yes,
        verbose: options.verbose,
      });
      outro("Upgrade complete.");
    });

  program
    .command("export")
    .description("Export manifest entries in another format.")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .option("-o, --output <path>", "Write export to path")
    .option("--only-brew", "Only include Homebrew tap/brew/cask/mas entries")
    .option("--only-npm", "Only include npm entries")
    .option("--only-pnpm", "Only include pnpm entries")
    .option("--only-bun", "Only include bun entries")
    .option("--only-uv", "Only include uv entries")
    .option("--only-repos", "Only include git repository entries")
    .option("--brewfile", "Export as Homebrew Brewfile")
    .option("--package-json", "Export npm/pnpm/bun entries as package.json dependencies")
    .option("--requirements-txt", "Export uv tool package names as requirements.txt")
    .option("--manifest", "Export as macpack manifest")
    .action(async (options: ExportOptions) => {
      const file = await resolveManifestPath(options.file, { global: options.global });
      const manifest = await parseManifestFile(file);
      const format = exportFormat(options);
      const filtered = filterManifest(manifest, exportFilter(options));
      const content = formatExport(filtered, format);
      await writeOrPrint(content, options.output);
    });

  program
    .command("check")
    .description("Parse manifest and print package counts.")
    .option("-f, --file <path>", "Manifest file")
    .option("-g, --global", "Use the global config manifest")
    .action(async (options: FileOptions) => {
      const file = await resolveManifestPath(options.file, { global: options.global });
      const manifest = await parseManifestFile(file);
      console.table({
        taps: manifest.taps.length,
        brews: manifest.brews.length,
        casks: manifest.casks.length,
        mas: manifest.masApps.length,
        npm: manifest.npmPackages.length,
        pnpm: manifest.pnpmPackages.length,
        bun: manifest.bunPackages.length,
        uv: manifest.uvTools.length,
        repos: manifest.repos.length,
      });
    });

  program
    .command("doctor")
    .description("Show macOS and package manager availability.")
    .action(async () => {
      const rows: Record<string, string> = {
        macos: isMacOS() ? "yes" : "no",
        brew: await doctorBrew(),
        node: await versionOrMissing("node", ["--version"]),
        npm: await versionOrMissing("npm", ["--version"]),
        volta: (await commandExists("volta")) ? await versionOrMissing("volta", ["--version"]) : "missing",
        pnpm: await versionOrMissing("pnpm", ["--version"]),
        bun: await versionOrMissing("bun", ["--version"]),
        python3: await versionOrMissing("python3", ["--version"]),
        uv: await versionOrMissing("uv", ["--version"]),
        git: await versionOrMissing("git", ["--version"]),
      };
      log.info(Object.entries(rows).map(([name, value]) => `${name.padEnd(8)} ${value}`).join("\n"));
    });

  return program;
}

async function resolveWritableManifestPath(file?: string, options: { global?: boolean } = {}): Promise<string> {
  if (file && options.global) throw new Error("Use either --file or --global, not both.");
  if (file) return resolve(file);
  if (options.global) return configManifestPath();

  const local = localManifestPath();
  if (await pathExists(local)) return local;

  const config = configManifestPath();
  if (await pathExists(config)) return config;

  log.info(`No manifest found. Creating ${local}`);
  return local;
}

async function openEditor(file: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (editor) {
    await run("sh", ["-lc", `${editor} ${shellEscape(file)}`]);
    return;
  }

  await run("open", ["-t", file]);
}

function normalizeKind(kind: string): ManifestEntryKind {
  if (["tap", "brew", "cask", "mas", "npm", "pnpm", "bun", "uv", "repo"].includes(kind)) {
    return kind as ManifestEntryKind;
  }
  throw new Error(`Unsupported entry kind "${kind}". Use tap, brew, cask, mas, npm, pnpm, bun, uv, or repo.`);
}

async function selectUpgradeCandidates(candidates: UpgradeCandidate[]): Promise<UpgradeCandidate[]> {
  const selectedIds = await multiselect({
    message: "Select upgrades to install",
    required: false,
    options: candidates.map((candidate) => ({
      value: candidate.id,
      label: `${candidate.kind} ${candidate.name}`,
      hint: `${candidate.current} -> ${candidate.latest}`,
    })),
  });

  if (isCancel(selectedIds)) {
    cancel("Cancelled.");
    process.exit(130);
  }

  const ids = new Set(selectedIds as string[]);
  return candidates.filter((candidate) => ids.has(candidate.id));
}

function reposMatchingValues(
  repos: Array<{ url: string; targetDir: string }>,
  values: string[],
): Array<{ url: string; targetDir: string }> {
  const removeSet = new Set(values);
  return repos.filter((repo) => removeSet.has(repo.targetDir) || removeSet.has(repo.url));
}

function exportFilter(options: ExportOptions): ExportFilter {
  return {
    brew: options.onlyBrew,
    npm: options.onlyNpm,
    pnpm: options.onlyPnpm,
    bun: options.onlyBun,
    uv: options.onlyUv,
    repos: options.onlyRepos,
  };
}

function exportFormat(options: ExportOptions): ExportFormat {
  const formats: ExportFormat[] = [];
  if (options.brewfile) formats.push("brewfile");
  if (options.packageJson) formats.push("package-json");
  if (options.requirementsTxt) formats.push("requirements-txt");
  if (options.manifest) formats.push("manifest");

  if (formats.length > 1) {
    throw new Error("Choose only one export format.");
  }

  return formats[0] ?? "manifest";
}

async function writeOrPrint(content: string, outputPath?: string): Promise<void> {
  if (!outputPath) {
    process.stdout.write(content);
    return;
  }

  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content, "utf8");
  console.log(output);
}

async function versionOrMissing(command: string, args: string[]): Promise<string> {
  if (!(await commandExists(command))) return "missing";
  const result = await capture(command, args);
  return (result.stdout || result.stderr).trim().split("\n")[0] || "installed";
}
