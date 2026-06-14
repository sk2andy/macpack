# macpack

macpack is a universal macOS package manager CLI. It syncs one manifest across
Homebrew, Mac App Store apps, npm/Volta tools, pnpm tools, bun tools, and uv
Python tools.

It is designed for personal machine bootstrap and repeatable workstation setup.

## Features

- One line-oriented manifest for `tap`, `brew`, `cask`, `mas`, `npm`, `pnpm`,
  `bun`, and `uv`.
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

The Homebrew formula installs the `v0.1` macOS Apple Silicon executable from
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

`macpack setup` asks whether it should create the config default. If yes, it
also asks whether to prefill it from currently installed packages. `macpack add`
creates the target manifest if it does not exist.

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
7. Asks whether `~/.config/macpack/packages.macpack` should be created.
8. If yes, asks whether it should be prefilled from installed packages.

Prefill collects:

- Homebrew taps, formula leaves, and casks
- Mac App Store apps from `mas list`
- npm globals and Volta packages
- pnpm globals
- bun globals from `~/.bun/install/global/package.json`
- uv tools from `uv tool list`

`uv tool list` does not expose the Python version used for each tool, so setup
asks for a Python version and writes that value for discovered uv tools.

### `apply`

Install or update packages in the manifest:

```bash
macpack apply --file examples/packages.macpack
macpack apply
```

Remove packages that are installed but no longer listed:

```bash
macpack apply --file examples/packages.macpack --cleanup
```

Preview commands without making changes:

```bash
macpack apply --file examples/packages.macpack --dry-run
```

Stream full command output instead of collapsed step logs:

```bash
macpack apply --verbose
```

### `add`

Add entries to a manifest:

```bash
macpack add brew gh
macpack add cask postman
macpack add npm typescript@5.9.3 tsx
macpack add pnpm serve
macpack add bun @johnlindquist/worktree
macpack add uv --python 3.14 serena-agent
macpack add mas --id 409183694 Keynote
```

Use `--file <path>` to edit a specific manifest. Without `--file`, macpack uses
the default manifest lookup.

### `remove`

Remove entries from a manifest:

```bash
macpack remove brew gh
macpack remove npm tsx
macpack remove uv serena-agent
macpack remove mas 409183694
```

This edits the file only. Run `macpack apply --cleanup` or `macpack cleanup` to
remove installed packages no longer listed.

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
macpack upgrade --all
macpack upgrade bun --all
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
provide a tag/version such as `v0.1`.

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
