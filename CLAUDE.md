# CLAUDE.md

This file provides guidance to AI agents when working with code in this repository.

Dotfiles managed with GNU Stow. `home/` mirrors `~` and gets symlinked.

## Stow Commands

```bash
stow home -t ~      # create symlinks
stow -D home -t ~   # remove symlinks
stow -R home -t ~   # restow (after adding/removing files)
stow -n home -t ~   # dry run
```

## Key Insight

Editing `~/.config/nvim/*` edits files in this repo (symlinked).

## Adding/Removing Dotfiles

```bash
dot add ~/.foo       # move file into home/, restow
dot remove ~/.foo    # remove symlink, move file back to ~/
```

Both support `-n` for dry-run.

## Configs

### Neovim (`home/.config/nvim/`)

LazyVim-based, supports standalone + VSCode-Neovim. See `home/.config/nvim/CLAUDE.md`.

- `vim.g.vscode` detects VSCode
- `vscode = false` disables plugin in VSCode
- Keymaps: `keymaps.lua` (shared), `nvim_keymaps.lua`, `vscode_keymaps.lua`

### Claude Code (`home/.claude/`)

Synced via stow: `CLAUDE.md`, `agents/`, `skills/`, `statusline-command.sh`

Not synced (machine-specific): `settings.json`, `cache/`, `plugins/`, `history.jsonl`

**Settings sync:** `~/.claude/settings.json` is NOT symlinked. Instead, shared settings live in `config/claude-settings-shared.json` and are selectively merged into each machine's local `settings.json` via the CLI:

- `dot claude pull` — overwrite shared keys in local settings from shared file
- `dot claude push` — update shared file with local values for shared keys
- `dot claude share <key>` — start sharing a top-level property
- `dot claude unshare <key>` — stop sharing a top-level property

Only top-level keys present in the shared file are synced. Machine-specific keys (e.g., `enabledPlugins`) are never touched by pull.

## Brewfile

Located at repo root. Format: `brew "pkg"`, `cask "app"`. Run via `init` command.

## CLI

Effect-based dotfiles manager. Source in `cli/src/`, config at root.

```bash
bun install          # install deps
bun run build        # compile to ./dot binary
bun run dev          # run without compiling
bun run test         # run tests (vitest, not bun test)
bun run typecheck    # type check
```

See `cli/CLAUDE.md` for commands, patterns, Effect practices.
