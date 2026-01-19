# Dotfiles

Personal dotfiles managed with GNU Stow.

## Usage

Install stow:
```bash
brew install stow
```

From this directory, stow a package to create symlinks in home directory:
```bash
stow nvim    # Links ~/.config/nvim
stow claude  # Links ~/.claude/CLAUDE.md
```

To remove symlinks:
```bash
stow -D nvim
stow -D claude
```

## Packages

- **nvim** - Neovim configuration (LazyVim-based)
- **claude** - Claude Code configuration
