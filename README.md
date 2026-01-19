# Dotfiles

Personal dotfiles managed with GNU Stow.

## Structure

The `home` directory mirrors the home directory structure:

```
home/
├── .config/
│   └── nvim/       → ~/.config/nvim
└── .claude/
    └── CLAUDE.md   → ~/.claude/CLAUDE.md
```

## Usage

Install stow:
```bash
brew install stow
```

From this directory, stow to create symlinks in home directory:
```bash
stow home -t ~
```

To remove symlinks:
```bash
stow -D home -t ~
```

## Contents

- **nvim** - Neovim configuration (LazyVim-based)
- **claude** - Claude Code CLAUDE.md
