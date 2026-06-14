import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await writeFile(
  join(root, "src/version.ts"),
  `export const VERSION = ${JSON.stringify(packageJson.version)};\n`,
  "utf8",
);
