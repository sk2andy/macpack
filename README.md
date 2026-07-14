# macpack

macpack is a universal macOS package manager CLI. It syncs one manifest across
Homebrew, Mac App Store apps, npm/Volta tools, pnpm tools, bun tools, uv
Python tools, and git repositories.

It is designed for personal machine bootstrap and repeatable workstation setup.

## Features

- One line-oriented manifest for `tap`, `brew`, `cask`, `mas`, `npm`, `pnpm`,
  `bun`, `uv`, and `repo`.
- Default manifest lookup: `./packages.macpack` first, then
  `~/.config/macpack/packages.macpack`.
- `add` and `remove` commands for editing manifest entries.
- `upgrade` command with interactive package selection or `--all`.
- Interactive `setup` command built with `@clack/prompts`.
- macOS-only guard for mutating commands.
- Homebrew tap trust prompts before installing from non-official taps.
- Manifest-scoped apply behavior: macpack installs entries named in the file
  instead of running broad global upgrades.
- Cleanup mode removes installed global packages/tools that are no longer in
  the manifest.
- Collapsed apply logs: successful command output is hidden, warnings stay
  visible, and failures print full command output. Use `--verbose` to stream all
  output.
- Build output is a normal Node executable with a `bin` entry for future npm and
  Homebrew distribution.

## Install From Source

```bash
git clone https://github.com/sk2andy/macpack.git
cd macpack
npm install
npm run build
node dist/index.js --help
```

## Install With Homebrew

```bash
brew tap sk2andy/tap
brew install macpack
```

Or install directly:

```bash
brew install sk2andy/tap/macpack
```

The Homebrew formula installs the `v0.3` macOS Apple Silicon executable from
the GitHub release.

For local development:

```bash
npm run dev -- --help
npm run dev -- check --file examples/packages.macpack
```

## Build A macOS Executable

On macOS Apple Silicon with Node.js 26:

```bash
npm run build:executable
./build/release/macpack --help
```

The executable is built with Node's Single Executable Application support. It is
written to `build/release/macpack`; `build/` and `dist/` are ignored and not
committed.

## Manifest Format

macpack uses a small, shell-like DSL. It is parsed by macpack and not executed as
a shell script.

```sh
tap "azure/functions"
brew "uv"
cask "postman"
mas "Keynote" "409183694"

npm "tsx"
pnpm "serve"
bun "@johnlindquist/worktree"
uv "3.14" "serena-agent"

repo "https://github.com/sk2andy/macpack.git" "~/workspace/macpack"
```

Comments are supported:

```sh
# Homebrew CLI tools
brew "gh"
brew "fzf"
```

Versioned specs are passed through to the underlying manager where that manager
supports them:

```sh
npm "typescript@5.9.3"
pnpm "serve@14"
bun "prettier@3.7.4"
uv "3.14" "ruff==0.14.8"
```

## Default Manifest

Every command that accepts `--file` can run without it. macpack resolves the
manifest in this order:

1. `./packages.macpack` in the current directory, if it exists.
2. `~/.config/macpack/packages.macpack`.

`macpack setup` asks whether it should create the config default when it is
missing. It then always asks whether to scan currently installed packages and
whether to scan home-folder git repositories for the global manifest. Commands
can force the global config manifest with `--global`. `macpack add --global`
creates that file if it does not exist. Without `--file` or `--global`, `add`
uses the default lookup and creates `./packages.macpack` with a log message if
neither default exists.

Common shortcuts:

- `-f, --file <path>`
- `-g, --global`
- `-n, --dry-run`
- `-v, --verbose`
- `-y, --yes`
- `-a, --all` for `upgrade`
- `-p, --python <version>` for `add uv`
- `-i, --id <app-id>` for `add mas`
- `--delete` for `remove repo`

## Commands

### `setup`

Interactive bootstrap for a new Mac:

```bash
macpack setup
```

The setup flow:

1. Checks that macpack runs on macOS.
2. Installs Homebrew if missing.
3. If Node.js is missing, asks for one of:
   - Volta (recommended)
   - Homebrew Node
   - nvm
   - skip
4. Asks whether bun should be installed and from which source:
   - official bun installer
   - Homebrew
   - skip
5. If Python 3 is missing, asks for a default version and install source:
   - uv-managed Python (recommended, default `3.14`)
   - pyenv
   - Homebrew Python
   - skip
6. Installs uv if missing.
7. Asks whether `~/.config/macpack/packages.macpack` should be created if missing.
8. Asks whether currently installed packages should be scanned.
9. Asks whether the home folder should be scanned for git repositories.

Package scans collect:

- Homebrew taps, formula leaves, and casks
- Mac App Store apps from `mas list`
- npm globals and Volta packages
- pnpm globals
- bun globals from `~/.bun/install/global/package.json`
- uv tools from `uv tool list`
- git repositories under the home folder when enabled, skipping
  `worktree-directories`, `worktrees`, git worktree roots, and common
  cache/media folders

`uv tool list` does not expose the Python version used for each tool, so setup
asks for a Python version and writes that value for discovered uv tools.
Scan results are merged into the global manifest and deduped, preserving
existing manual entries.

### `apply`

Install or update packages in the manifest:

```bash
macpack apply --file examples/packages.macpack
macpack apply
macpack apply npm
macpack apply brew
```

Repository entries are cloned when their target directory is missing. Existing
repositories are left in place; if the target exists with a different origin,
apply fails instead of overwriting it.

Pass a manager to apply only that section and skip the others. Supported
managers are `brew`, `npm`, `pnpm`, `bun`, `uv`, `repo`, `repos`, and `all`.

Remove packages that are installed but no longer listed:

```bash
macpack apply --file examples/packages.macpack --cleanup
macpack apply npm --cleanup
```

Preview commands without making changes:

```bash
macpack apply -f examples/packages.macpack -n
```

Stream full command output instead of collapsed step logs:

```bash
macpack apply -v
```

### `add`

Add entries to a manifest:

```bash
macpack add brew gh
macpack add cask postman
macpack add npm typescript@5.9.3 tsx
macpack add pnpm serve
macpack add bun @johnlindquist/worktree
macpack add uv -p 3.14 serena-agent
macpack add mas -i 409183694 Keynote
macpack add repo https://github.com/sk2andy/macpack.git ~/workspace/macpack
```

Use `--file <path>` to edit a specific manifest. Without `--file`, macpack uses
the default manifest lookup. If neither default exists, `add` creates
`./packages.macpack` and logs that path.

Use `--global` to edit `~/.config/macpack/packages.macpack` directly:

```bash
macpack add -g brew gh
```

### `remove`

Remove entries from a manifest:

```bash
macpack remove brew gh
macpack remove npm tsx
macpack remove uv serena-agent
macpack remove mas 409183694
macpack remove repo ~/workspace/macpack
macpack remove repo ~/workspace/macpack --delete
```

This edits the file only. Run `macpack apply --cleanup` or `macpack cleanup` to
remove installed packages no longer listed. Repositories are never removed by
`apply --cleanup` or `cleanup`; only `remove repo --delete` deletes a repo
folder.

### `list`

Print manifest entries:

```bash
macpack list
macpack ls -g
macpack list --only-brew
```

`list` supports the same default lookup, `-f/--file`, `-g/--global`, and
`--only-*` filters as `export`.

### `edit`

Open the manifest in your editor:

```bash
macpack edit
macpack edit -g
macpack edit -f examples/packages.macpack
```

`edit` uses `$VISUAL`, then `$EDITOR`, then macOS `open -t`. If no manifest
exists, it creates `./packages.macpack`; with `-g`, it creates the global config
manifest.

### `upgrade`

Find newer versions for entries in the manifest and select what to install:

```bash
macpack upgrade
macpack upgrade brew
macpack upgrade npm
macpack upgrade uv
```

Upgrade/install everything in the selected scope without prompts:

```bash
macpack upgrade -a
macpack upgrade bun -a
```

With `--all`, macpack applies the matching manifest section directly, so missing
entries are installed and installed entries are refreshed to the newest version
allowed by their manifest spec.

Use `--verbose` to stream package-manager output instead of collapsing
successful steps.

### `cleanup`

Only remove extras not present in the manifest:

```bash
macpack cleanup --file examples/packages.macpack
macpack cleanup
```

Use `--verbose` to stream cleanup command output.

### `export`

Export the manifest, or selected managers, into another format:

```bash
macpack export --file examples/packages.macpack
macpack export
macpack export --file examples/packages.macpack --only-brew --brewfile
macpack export --file examples/packages.macpack --package-json
macpack export --file examples/packages.macpack --only-uv --requirements-txt
```

Filters:

- `--only-brew`
- `--only-npm`
- `--only-pnpm`
- `--only-bun`
- `--only-uv`
- `--only-repos`

Formats:

- default macpack manifest
- `--brewfile`
- `--package-json`
- `--requirements-txt`

### `check`

Parse the manifest and print counts:

```bash
macpack check --file examples/packages.macpack
macpack check
```

### `doctor`

Show platform and package-manager availability:

```bash
macpack doctor
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run build:executable
npm audit --audit-level=high
npm pack --dry-run
```

## Releases

Releases are built by GitHub Actions. Run the `Release` workflow manually and
provide a tag/version such as `v0.3`.

The workflow runs on GitHub's `macos-26` arm64 runner, builds a darwin-arm64
executable, creates a source archive, creates checksums, and publishes a GitHub
Release with those assets.

## Project Structure

```text
src/
  cli/         command definitions
  config/      manifest parser, formatter, defaults, and mutations
  core/        process execution, prompts, platform checks, shared types
  installers/  one installer per package ecosystem
  setup/       interactive bootstrap flow
  upgrades/    outdated detection and upgrade selection
docs/          architecture, command, and feature notes
examples/      example macpack manifest
```

## Publishing Notes

The npm package exposes:

```json
{
  "bin": {
    "macpack": "./dist/index.js"
  }
}
```

`prepack` runs the build before packaging, so `dist/index.js` is included in the
published tarball.

## License

MIT
