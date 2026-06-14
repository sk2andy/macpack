# Architecture

## Layers

- `src/cli`: command definitions and option parsing.
- `src/config`: manifest parser and Brewfile formatter.
- `src/core`: process execution, platform checks, and shared types.
- `src/installers`: one installer per package ecosystem.
- `src/setup`: interactive bootstrap flows.

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

## Manifest Format

Line-oriented DSL:

```sh
command "arg1" "arg2"
```

Comments start with `#` outside quoted strings. Supported commands: `tap`, `brew`, `cask`, `mas`, `npm`, `pnpm`, `bun`, `uv`.
