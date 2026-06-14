import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { intro, isCancel, log, multiselect, outro, cancel } from "@clack/prompts";
import { Command } from "commander";
import { resolveManifestPath } from "../config/defaults.js";
import { filterManifest, formatExport, type ExportFilter, type ExportFormat } from "../config/exporters.js";
import { addEntries, removeEntries, type ManifestEntryKind } from "../config/mutate.js";
import { parseManifestFile } from "../config/parser.js";
import { commandExists, capture } from "../core/exec.js";
import { assertMacOS, isMacOS } from "../core/platform.js";
import { applyAll, cleanupAll } from "../installers/index.js";
import { doctorBrew } from "../installers/brew.js";
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
}

interface AddOptions extends FileOptions {
  python?: string;
  id?: string;
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
    .description("Universal macOS package manager for Homebrew, npm, pnpm, bun, and uv.")
    .version(VERSION);

  program
    .command("setup")
    .description("Interactive macOS bootstrap for Homebrew, Node.js, bun, Python, and uv.")
    .option("--dry-run", "Print install commands without running them")
    .action(async (options: { dryRun?: boolean }) => {
      await runSetup({ dryRun: options.dryRun });
    });

  program
    .command("apply")
    .description("Install/update all packages from a manifest.")
    .option("-f, --file <path>", "Manifest file")
    .option("--cleanup", "Remove installed tools not present in manifest")
    .option("-y, --yes", "Answer yes to trust prompts")
    .option("--dry-run", "Print commands without running them")
    .option("--verbose", "Stream command output instead of collapsing successful steps")
    .action(async (options: MutatingOptions) => {
      assertMacOS();
      intro("macpack apply");
      const file = await resolveManifestPath(options.file);
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
    .option("-y, --yes", "Assume yes where a prompt is needed")
    .option("--dry-run", "Print commands without running them")
    .option("--verbose", "Stream command output instead of collapsing successful steps")
    .action(async (options: MutatingOptions) => {
      assertMacOS();
      intro("macpack cleanup");
      const file = await resolveManifestPath(options.file);
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
    .argument("<kind>", "tap, brew, cask, mas, npm, pnpm, bun, or uv")
    .argument("<packages...>", "Package names, uv specs, or one mas app name")
    .option("-f, --file <path>", "Manifest file")
    .option("-p, --python <version>", "Python version for uv entries")
    .option("--id <app-id>", "Mac App Store app id for mas entries")
    .action(async (kind: ManifestEntryKind, packages: string[], options: AddOptions) => {
      const file = await resolveManifestPath(options.file);
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
    .argument("<kind>", "tap, brew, cask, mas, npm, pnpm, bun, or uv")
    .argument("<packages...>", "Package names, uv package names, mas ids, or mas names")
    .option("-f, --file <path>", "Manifest file")
    .action(async (kind: ManifestEntryKind, packages: string[], options: FileOptions) => {
      const file = await resolveManifestPath(options.file);
      const result = await removeEntries(file, normalizeKind(kind), packages);
      log.success(`Removed ${result.removed ?? 0} entr${result.removed === 1 ? "y" : "ies"} from ${result.path}`);
    });

  program
    .command("upgrade")
    .description("Find and install newer versions for manifest entries.")
    .argument("[manager]", "brew, npm, pnpm, bun, uv, or all", "all")
    .option("-f, --file <path>", "Manifest file")
    .option("--all", "Upgrade/install all matching manifest entries without prompting")
    .option("-y, --yes", "Answer yes to trust prompts")
    .option("--dry-run", "Print commands without running them")
    .option("--verbose", "Stream command output instead of collapsing successful steps")
    .action(async (manager: string, options: UpgradeOptions) => {
      assertMacOS();
      intro("macpack upgrade");
      const file = await resolveManifestPath(options.file);
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
    .option("-o, --output <path>", "Write export to path")
    .option("--only-brew", "Only include Homebrew tap/brew/cask/mas entries")
    .option("--only-npm", "Only include npm entries")
    .option("--only-pnpm", "Only include pnpm entries")
    .option("--only-bun", "Only include bun entries")
    .option("--only-uv", "Only include uv entries")
    .option("--brewfile", "Export as Homebrew Brewfile")
    .option("--package-json", "Export npm/pnpm/bun entries as package.json dependencies")
    .option("--requirements-txt", "Export uv tool package names as requirements.txt")
    .option("--manifest", "Export as macpack manifest")
    .action(async (options: ExportOptions) => {
      const file = await resolveManifestPath(options.file);
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
    .action(async (options: FileOptions) => {
      const file = await resolveManifestPath(options.file);
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
      };
      log.info(Object.entries(rows).map(([name, value]) => `${name.padEnd(8)} ${value}`).join("\n"));
    });

  return program;
}

function normalizeKind(kind: string): ManifestEntryKind {
  if (["tap", "brew", "cask", "mas", "npm", "pnpm", "bun", "uv"].includes(kind)) {
    return kind as ManifestEntryKind;
  }
  throw new Error(`Unsupported entry kind "${kind}". Use tap, brew, cask, mas, npm, pnpm, bun, or uv.`);
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

function exportFilter(options: ExportOptions): ExportFilter {
  return {
    brew: options.onlyBrew,
    npm: options.onlyNpm,
    pnpm: options.onlyPnpm,
    bun: options.onlyBun,
    uv: options.onlyUv,
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
