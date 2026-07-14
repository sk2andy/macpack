# Architecture

## Layers

- `src/cli`: command definitions and option parsing.
- `src/config`: manifest parser, formatter, default path resolution, and file mutations.
- `src/core`: process execution, platform checks, and shared types.
- `src/installers`: one installer per package ecosystem plus repository sync.
- `src/setup`: interactive bootstrap flows.
- `src/upgrades`: outdated detection, manager filtering, and upgrade manifests.

## Install Flow

1. Parse manifest file into typed sections.
2. Check macOS when command mutates machine state.
3. Select the requested apply manager from `apply [manager]`; `all` keeps every section.
4. Run ecosystem installers only for selected sections that have manifest entries:
   - Homebrew ensures taps, prompts for tap trust, and installs formulae, casks, and MAS apps as individual progress steps. Brew Bundle is only used for cleanup.
   - npm prefers Volta when present and falls back to npm globals.
   - pnpm uses global add/remove.
   - bun uses global install/remove.
   - uv uses `uv tool install --upgrade -p <python> <package>`.
   - repos use `git clone <url> <target>` when the target directory is missing.
5. Cleanup removes installed global tools not present in manifest when requested or when command is `cleanup`.

macpack avoids broad `upgrade all globals` commands. Apply operations target packages named in the manifest.
Repository entries are never deleted by apply or cleanup. Deletion requires
`macpack remove repo <target> --delete`.

## Default Manifest Resolution

Commands with `--file` accept an explicit manifest path. Without it, macpack
uses `./packages.macpack` when present, otherwise
`~/.config/macpack/packages.macpack`. `--global` forces the config manifest. If
neither exists, read commands fail with a clear error. Setup can create the
config default and always offers package and repository scans for the global
manifest. `add` creates `./packages.macpack` when neither default exists.
`add --global` writes the config manifest directly.

## Discovery Flow

Setup scans use `src/config/discovery.ts` to collect installed packages and
repositories:

- `brew tap`, `brew leaves`, and `brew list --cask`
- `mas list`
- `npm ls -g --depth=0 --json` and `volta list all`
- `pnpm list -g --depth=0 --json`
- Bun's global `package.json`
- `uv tool list`
- optional home-folder git repository scan, skipping `worktree-directories`,
  `worktrees`, git worktree roots, and common cache/media folders

Collected entries are merged into the global manifest, deduped, and sorted
before writing.

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

Comments start with `#` outside quoted strings. Supported commands: `tap`,
`brew`, `cask`, `mas`, `npm`, `pnpm`, `bun`, `uv`, `repo`.
