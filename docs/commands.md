# Commands

## `setup`

Interactive bootstrap for macOS:

1. Refuse non-macOS platforms.
2. Install Homebrew if missing.
3. If Node.js is missing, ask for installation source:
   - Volta (recommended)
   - Homebrew Node
   - nvm
   - skip
4. Ask whether bun should be installed:
   - official script
   - Homebrew
   - skip
5. If Python 3 is missing, ask for installation source and default version:
   - uv-managed Python (recommended, default `3.14`)
   - pyenv
   - Homebrew Python
   - skip
6. If uv is missing, ask whether to install it.
7. Ask whether to create `~/.config/macpack/packages.macpack`.
8. If yes, ask whether to prefill it from installed packages.

Default manifest prefill collects Homebrew taps/formulae/casks, MAS apps, npm
globals, Volta packages, pnpm globals, bun globals, and uv tools. Because
`uv tool list` does not expose the Python version for tools, setup asks for one
Python version and uses it for discovered uv entries.

## Manifest path default

Commands with `--file` also work without it. Default lookup:

1. `./packages.macpack`
2. `~/.config/macpack/packages.macpack`

Use `--global` to force `~/.config/macpack/packages.macpack`. If neither
default exists, read commands fail with a clear error. `add` creates
`./packages.macpack` with a log message unless `--global` or `--file` was
passed.

Shortcuts:

- `-f, --file <path>`
- `-g, --global`
- `-n, --dry-run`
- `-v, --verbose`
- `-y, --yes`
- `-a, --all`
- `-p, --python <version>`
- `-i, --id <app-id>`

## `apply [--file <path>]`

Install/update packages in the manifest. Use `--cleanup` to remove installed tools not in the manifest. Managers with no entries are skipped.

By default, successful command output is collapsed into step status lines.
Warnings remain visible. Failures print full command output. Use `--verbose` to
stream package-manager output.

## `add <kind> <packages...> [--file <path>]`

Add entries to a manifest.

Kinds:

- `tap`
- `brew`
- `cask`
- `mas`
- `npm`
- `pnpm`
- `bun`
- `uv`

Examples:

```bash
macpack add brew gh
macpack add -g brew gh
macpack add npm typescript@5.9.3 tsx
macpack add uv -p 3.14 serena-agent
macpack add mas -i 409183694 Keynote
```

## `remove <kind> <packages...> [--file <path>]`

Remove entries from a manifest. For `mas`, package values can be ids or names.

Examples:

```bash
macpack remove brew gh
macpack remove uv serena-agent
macpack remove mas 409183694
```

## `upgrade [manager] [--file <path>]`

Check manifest entries for newer versions and ask which ones to install.

Managers:

- `all` (default)
- `brew`
- `npm`
- `pnpm`
- `bun`
- `uv`

Examples:

```bash
macpack upgrade
macpack upgrade brew
macpack upgrade npm -a
macpack upgrade uv -a
```

`--all` skips prompts and applies the selected manifest section, installing missing entries and refreshing existing entries.

Use `--verbose` to stream package-manager output.

## `cleanup [--file <path>]`

Remove global packages/tools not present in the manifest. Managers with no entries are skipped, so an npm-only manifest does not require Homebrew.

Use `--verbose` to stream package-manager output.

## `export [--file <path>]`

Export the manifest or filtered parts of it.

Filters:

- `--only-brew`
- `--only-npm`
- `--only-pnpm`
- `--only-bun`
- `--only-uv`

Formats:

- macpack manifest by default
- `--brewfile`
- `--package-json`
- `--requirements-txt`

Examples:

```bash
macpack export --file packages.macpack --only-brew --brewfile
macpack export --file packages.macpack --package-json
macpack export --file packages.macpack --only-uv --requirements-txt
```

## `check [--file <path>]`

Parse manifest and print section counts.

## `doctor`

Print platform and tool availability.
