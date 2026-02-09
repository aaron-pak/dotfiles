# Dotfiles

Personal dotfiles managed with the `dot` CLI, built on [GNU Stow](https://www.gnu.org/software/stow/) and [Effect](https://effect.website/).

## New Machine Setup

```bash
git clone <repo-url> ~/projects/dotfiles
cd ~/projects/dotfiles
bun install && bun run build
./dot init
```

`dot init` will:

1. Install [Homebrew](https://brew.sh/) (if missing)
2. Install packages from `Brewfile` (stow, neovim, ripgrep, ghostty)
3. Sync dotfiles to `~` via GNU Stow (with interactive conflict resolution)
4. Pull shared Claude Code settings into `~/.claude/settings.json`

Use `--skip-brew` to skip the Homebrew phase, or `-n` for a dry run.

## Commands

### Sync dotfiles

```bash
dot sync            # sync home/ -> ~ via stow
dot sync -n         # dry run
```

If conflicts are found (existing files where symlinks should go), you'll be prompted to backup, delete, or abort.

### Add a dotfile

```bash
dot add .zshrc              # moves ~/.zshrc into home/, restows
dot add .config/ghostty     # works with directories too
dot add -n .zshrc           # dry run
```

Paths are relative to `~`.

### Remove a dotfile

```bash
dot remove .zshrc           # removes symlink, moves file back to ~/
dot remove -n .zshrc        # dry run
```

### Claude Code settings

`~/.claude/settings.json` is not symlinked because some properties differ between machines. Instead, shared keys are selectively synced via `config/claude-settings-shared.json`.

```bash
dot claude pull             # merge shared keys into local settings.json
dot claude push             # update shared file from local values
dot claude share <key>      # start sharing a top-level key
dot claude unshare <key>    # stop sharing a top-level key
```

All support `-n` for dry run (except `share`/`unshare`).

Only keys present in the shared file are synced. Machine-specific keys are never touched by pull.

## What's Included

| Config | Path | Notes |
|--------|------|-------|
| Neovim | `home/.config/nvim/` | LazyVim with VSCode-Neovim support |
| Claude Code | `home/.claude/` | CLAUDE.md, agents, skills, statusline |
| Ghostty | `home/.config/ghostty/` | Terminal config |
| Ripgrep | `home/.config/ripgrep/` | Search config |

## Development

```bash
bun install          # install deps
bun run build        # compile to ./dot binary
bun run dev          # run without compiling (e.g. bun run dev sync -n)
bun run test         # run tests (vitest)
bun run typecheck    # type check
```

Source is in `cli/src/`. See `cli/CLAUDE.md` for architecture and patterns.
