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

## `apply --file <path>`

Install/update packages in the manifest. Use `--cleanup` to remove installed tools not in the manifest. Managers with no entries are skipped.

## `cleanup --file <path>`

Remove global packages/tools not present in the manifest. Managers with no entries are skipped, so an npm-only manifest does not require Homebrew.

## `brewfile --file <path>`

Print a generated Homebrew Brewfile to stdout or write to `--output <path>`.

## `export --file <path>`

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

## `check --file <path>`

Parse manifest and print section counts.

## `doctor`

Print platform and tool availability.
