# Architecture

## Layers

- `src/cli`: command definitions and option parsing.
- `src/config`: manifest parser, formatter, default path resolution, and file mutations.
- `src/core`: process execution, platform checks, and shared types.
- `src/installers`: one installer per package ecosystem.
- `src/setup`: interactive bootstrap flows.
- `src/upgrades`: outdated detection, manager filtering, and upgrade manifests.

## Install Flow

1. Parse manifest file into typed sections.
2. Check macOS when command mutates machine state.
3. Run ecosystem installers only for sections that have manifest entries:
   - Homebrew writes a temporary Brewfile, ensures taps, prompts for tap trust, runs bundle, and cleanup.
   - npm prefers Volta when present and falls back to npm globals.
   - pnpm uses global add/remove.
   - bun uses global install/remove.
   - uv uses `uv tool install --upgrade -p <python> <package>`.
4. Cleanup removes installed global tools not present in manifest when requested or when command is `cleanup`.

macpack avoids broad `upgrade all globals` commands. Apply operations target packages named in the manifest.

## Default Manifest Resolution

Commands with `--file` accept an explicit manifest path. Without it, macpack
uses `./packages.macpack` when present, otherwise
`~/.config/macpack/packages.macpack`. Setup can create the config default,
optionally prefill it from installed packages, and `add` creates the resolved
target on first write.

## Discovery Flow

Setup prefill uses `src/config/discovery.ts` to collect installed packages:

- `brew tap`, `brew leaves`, and `brew list --cask`
- `mas list`
- `npm ls -g --depth=0 --json` and `volta list all`
- `pnpm list -g --depth=0 --json`
- Bun's global `package.json`
- `uv tool list`

The collected manifest is deduped and sorted before writing.

## Upgrade Flow

1. Resolve and parse the manifest.
2. Select managers from `upgrade [manager]`.
3. With `--all`, apply the matching manifest sections directly.
4. Without `--all`, collect outdated candidates per manager:
   - Homebrew uses `brew outdated --json=v2`.
   - npm/pnpm/bun compare installed global versions with registry metadata.
   - uv uses `uv tool list --outdated` when available and falls back to missing tool detection.
5. Prompt with `@clack/prompts` and apply only selected candidates.

## Manifest Format

Line-oriented DSL:

```sh
command "arg1" "arg2"
```

Comments start with `#` outside quoted strings. Supported commands: `tap`, `brew`, `cask`, `mas`, `npm`, `pnpm`, `bun`, `uv`.
