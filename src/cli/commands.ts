import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { Command } from "commander";
import { formatBrewfile } from "../config/brewfile.js";
import { filterManifest, formatExport, type ExportFilter, type ExportFormat } from "../config/exporters.js";
import { parseManifestFile } from "../config/parser.js";
import { commandExists, capture } from "../core/exec.js";
import { assertMacOS, isMacOS } from "../core/platform.js";
import { applyAll, cleanupAll } from "../installers/index.js";
import { doctorBrew } from "../installers/brew.js";
import { runSetup } from "../setup/setup.js";
import { VERSION } from "../version.js";

interface FileOptions {
  file: string;
}

interface MutatingOptions extends FileOptions {
  dryRun?: boolean;
  cleanup?: boolean;
  yes?: boolean;
}

interface BrewfileOptions extends FileOptions {
  output?: string;
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
    .requiredOption("-f, --file <path>", "Manifest file")
    .option("--cleanup", "Remove installed tools not present in manifest")
    .option("-y, --yes", "Answer yes to trust prompts")
    .option("--dry-run", "Print commands without running them")
    .action(async (options: MutatingOptions) => {
      assertMacOS();
      intro("macpack apply");
      const manifest = await parseManifestFile(resolve(options.file));
      await applyAll(manifest, {
        cleanup: options.cleanup,
        dryRun: options.dryRun,
        yes: options.yes,
      });
      outro("Apply complete.");
    });

  program
    .command("cleanup")
    .description("Remove installed global packages/tools not present in manifest.")
    .requiredOption("-f, --file <path>", "Manifest file")
    .option("-y, --yes", "Assume yes where a prompt is needed")
    .option("--dry-run", "Print commands without running them")
    .action(async (options: MutatingOptions) => {
      assertMacOS();
      intro("macpack cleanup");
      const manifest = await parseManifestFile(resolve(options.file));
      await cleanupAll(manifest, {
        dryRun: options.dryRun,
        yes: options.yes,
      });
      outro("Cleanup complete.");
    });

  program
    .command("export")
    .description("Export manifest entries in another format.")
    .requiredOption("-f, --file <path>", "Manifest file")
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
      const manifest = await parseManifestFile(resolve(options.file));
      const filtered = filterManifest(manifest, exportFilter(options));
      const content = formatExport(filtered, exportFormat(options));
      await writeOrPrint(content, options.output);
    });

  program
    .command("brewfile")
    .description("Generate a Homebrew Brewfile from the manifest.")
    .requiredOption("-f, --file <path>", "Manifest file")
    .option("-o, --output <path>", "Write Brewfile to path")
    .action(async (options: BrewfileOptions) => {
      const manifest = await parseManifestFile(resolve(options.file));
      await writeOrPrint(formatBrewfile(manifest), options.output);
    });

  program
    .command("check")
    .description("Parse manifest and print package counts.")
    .requiredOption("-f, --file <path>", "Manifest file")
    .action(async (options: FileOptions) => {
      const manifest = await parseManifestFile(resolve(options.file));
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
