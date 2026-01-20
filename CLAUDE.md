# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Adding Dotfiles

1. Mirror path: `~/.foo` → `home/.foo`
2. Move original: `mv ~/.foo home/.foo`
3. Restow: `stow -R home -t ~`

## Configs

### Neovim (`home/.config/nvim/`)

LazyVim-based, supports standalone + VSCode-Neovim. See `home/.config/nvim/CLAUDE.md`.

- `vim.g.vscode` detects VSCode
- `vscode = false` disables plugin in VSCode
- Keymaps: `keymaps.lua` (shared), `nvim_keymaps.lua`, `vscode_keymaps.lua`

### Claude Code (`home/.claude/`)

Synced: `CLAUDE.md`, `settings.json`, `agents/`, `skills/`

Not synced (machine-specific): `~/.claude.json`, `cache/`, `plugins/`, `history.jsonl`
