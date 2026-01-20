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

## CLI (`cli/`)

Effect-based CLI for managing dotfiles. See `cli/CLAUDE.md` for details.

```bash
cd cli && bun run dev  # Run CLI
```

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/opensource/effect/` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
