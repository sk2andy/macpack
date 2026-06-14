# macpack

macpack is a universal macOS package manager CLI. It syncs one manifest across
Homebrew, Mac App Store apps, npm/Volta tools, pnpm tools, bun tools, and uv
Python tools.

It is designed for personal machine bootstrap and repeatable workstation setup.

## Features

- One line-oriented manifest for `tap`, `brew`, `cask`, `mas`, `npm`, `pnpm`,
  `bun`, and `uv`.
- Interactive `setup` command built with `@clack/prompts`.
- macOS-only guard for mutating commands.
- Homebrew tap trust prompts before installing from non-official taps.
- Manifest-scoped apply behavior: macpack installs entries named in the file
  instead of running broad global upgrades.
- Cleanup mode removes installed global packages/tools that are no longer in
  the manifest.
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

### `apply`

Install or update packages in the manifest:

```bash
macpack apply --file examples/packages.macpack
```

Remove packages that are installed but no longer listed:

```bash
macpack apply --file examples/packages.macpack --cleanup
```

Preview commands without making changes:

```bash
macpack apply --file examples/packages.macpack --dry-run
```

### `cleanup`

Only remove extras not present in the manifest:

```bash
macpack cleanup --file examples/packages.macpack
```

### `brewfile`

Generate a Homebrew Brewfile from the Homebrew-only entries:

```bash
macpack brewfile --file examples/packages.macpack
macpack brewfile --file examples/packages.macpack --output Brewfile
```

### `export`

Export the manifest, or selected managers, into another format:

```bash
macpack export --file examples/packages.macpack
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
  config/      manifest parser and Brewfile formatter
  core/        process execution, prompts, platform checks, shared types
  installers/  one installer per package ecosystem
  setup/       interactive bootstrap flow
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
