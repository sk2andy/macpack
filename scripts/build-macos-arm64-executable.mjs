import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { arch, platform } from "node:process";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDir = join(root, "build");
const seaDir = join(buildDir, "sea");
const releaseDir = join(buildDir, "release");
const nodeDir = join(buildDir, "node");
const bundlePath = join(seaDir, "macpack.mjs");
const seaConfigPath = join(seaDir, "sea-config.json");
const executablePath = join(releaseDir, "macpack");

if (platform !== "darwin" || arch !== "arm64") {
  throw new Error(`macpack executable build requires darwin arm64, got ${platform} ${arch}`);
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const nodeVersion = process.version;

await rm(buildDir, { force: true, recursive: true });
await mkdir(seaDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });
await mkdir(nodeDir, { recursive: true });
const officialNodeBinary = await downloadOfficialNode(nodeVersion);

await execFileAsync("node", ["scripts/sync-version.mjs"], { cwd: root, stdio: "inherit" });

await execFileAsync(
  "npx",
  [
    "esbuild",
    "src/index.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node26",
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    `--outfile=${bundlePath}`,
  ],
  { cwd: root, stdio: "inherit" },
);

await writeFile(
  seaConfigPath,
  `${JSON.stringify(
    {
      main: bundlePath,
      mainFormat: "module",
      executable: officialNodeBinary,
      output: executablePath,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
      execArgvExtension: "none",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await execFileAsync(officialNodeBinary, ["--build-sea", seaConfigPath], { cwd: root, stdio: "inherit" });
await execFileAsync("codesign", ["--sign", "-", executablePath], { cwd: root, stdio: "inherit" });
await execFileAsync(executablePath, ["--version"], { cwd: root, stdio: "inherit" });

await writeFile(
  join(releaseDir, "README.txt"),
  `macpack ${packageJson.version}\n\nTarget: macOS Apple Silicon (darwin-arm64)\nRun: ./macpack --help\n`,
  "utf8",
);

console.log(executablePath);

async function downloadOfficialNode(version) {
  const archiveName = `node-${version}-darwin-arm64`;
  const archivePath = join(nodeDir, `${archiveName}.tar.gz`);
  const url = `https://nodejs.org/dist/${version}/${archiveName}.tar.gz`;

  await mkdir(nodeDir, { recursive: true });
  await execFileAsync("curl", ["-fsSL", url, "-o", archivePath], { cwd: root, stdio: "inherit" });
  await execFileAsync("tar", ["-xzf", archivePath, "-C", nodeDir], { cwd: root, stdio: "inherit" });

  return join(nodeDir, archiveName, "bin/node");
}
