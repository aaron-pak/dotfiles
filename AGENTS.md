# Dotfiles

This repository holds Aaron's native dotfiles, global agent instructions, and personal skills. Work with the user conversationally; there is no interactive configuration manager.

For machine setup, installing a personal skill, repairing links, or changing agent configuration, use `.codex/skills/configure-machine/SKILL.md`. Ordinary edits to an owned config usually need only the context below.

## Ownership

- `home/` mirrors `~/`. It contains files we own entirely and link into the home directory.
- `home/.codex/AGENTS.md` owns shared global instructions. `home/.claude/CLAUDE.md` imports that file and may add Claude-only guidance.
- This root `AGENTS.md` is for maintaining dotfiles, not for installation as global instructions. Root `CLAUDE.md` imports it.
- `.codex/skills/<name>/` is the canonical copy of each personal skill, including the configuration skill. `.claude/skills/configure-machine` exposes the configuration skill in this repo. Global installations are individual links selected for each machine.
- Claude and Codex settings, plugins, credentials, caches, sessions, and application-generated integration wiring stay local. There are no shared settings, settings merges, or installation manifests.
- `Brewfile` records the desired Homebrew packages. Use Homebrew itself to inspect and install them.

The stable checkout is normally `~/projects/dotfiles`. Inspect Git status and live link targets before editing or installing. Worktrees are for development; live links must point to a stable checkout. Preserve changes already present there when integrating work.

## Small filesystem helper

Use `bun run dev` (or `./dot` after `bun run build`) for these operations:

```sh
bun run dev link .config/ghostty/config --dry
bun run dev link .config/ghostty/config
bun run dev skill eli5 --tool codex --dry
bun run dev skill eli5 --tool codex
bun run dev sync --dry
bun run dev sync
```

`link` installs explicitly named files from `home/`. `skill` installs one skill for one harness. `sync` runs GNU Stow with an explicit target and `--no-folding`, and applies only `home/`. All commands are noninteractive; conflicts fail without replacement. `--home /absolute/path` supports isolated test homes. No command pulls Git, installs packages, modifies harness settings, or chooses which skills should be installed.

Use the helper for Stow operations rather than running Stow directly. To bring a file into the repository or stop tracking one, inspect it and its links, then perform the specific copy/move/unlink operation. Keep a recoverable copy before replacing user content. Uninstalling a skill removes only its selected installation link, not its canonical directory.

## Verification

```sh
bun install
bun run typecheck
bun run test
bun run test:e2e
bun run lint
git diff --check
```

Typechecking and tests must pass without warnings or failures. Run E2E checks when changing filesystem operations, command parsing, build paths, or installation layout. The E2E checks use isolated homes and the compiled helper; never test migrations against the real home directory.

Verify instruction imports and actual harness skill discovery after installing agent files. Report the files changed, installation targets, verification results, and any unresolved conflicts.

## Config details worth preserving

- Tmux: Catppuccin Mocha with a neutral dark background and burnt orange `#d08770` active labels. Keep the semver-shaped process-name substitution that displays Claude as `claude`.
- Ghostty: preserve the user's current theme and colors. Only Material Design Nerd Font icons (`nf-md-*`, U+F0000+) render reliably through fallback.
- Karabiner: only `karabiner.json` is managed; automatic backups and assets stay local. Device vendor/product IDs may differ on another machine.
- Neovim: read `home/.config/nvim/CLAUDE.md` before changing its configuration.
- Use Catppuccin Mocha for new terminal/config styling unless the user requests otherwise. Existing overrides take precedence; the user's global HTML artifact preferences apply to HTML.
