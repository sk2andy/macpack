# Features

- One manifest for Homebrew taps, formulae, casks, MAS apps, npm/Volta tools, pnpm tools, bun tools, and uv tools.
- Default manifest lookup via `./packages.macpack`, then `~/.config/macpack/packages.macpack`.
- Optional setup prefill from currently installed packages.
- Manifest editing via `add` and `remove`.
- Interactive or `--all` upgrades via `upgrade`.
- Interactive `setup` command for macOS bootstrap.
- macOS-only runtime check before setup/apply operations.
- Homebrew trust prompts for non-official taps when `HOMEBREW_REQUIRE_TAP_TRUST` is active.
- Sync behavior: install missing packages, upgrade installed packages, and optionally remove entries no longer present in the manifest.
- Collapsed apply/upgrade/cleanup logs with warnings and errors kept visible.
- Safe manifest parser: no shell evaluation.
- Buildable ESM CLI with npm `bin` entry for future npm/Homebrew distribution.
- Export command for generating Brewfiles, package.json dependency blocks,
  uv requirements-style files, or filtered macpack manifests.

## Non-goals

- Linux/Windows support.
- Managing project-local dependencies.
- Replacing version managers. macpack orchestrates Homebrew, Volta, bun, npm, pnpm, and uv.
