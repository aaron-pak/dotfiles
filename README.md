# Dotfiles

Personal dotfiles managed with [GNU Stow](https://www.gnu.org/software/stow/).

## Setup

```bash
# Install stow
brew install stow

# Clone repo
git clone <repo-url> ~/projects/dotfiles
cd ~/projects/dotfiles

# Create symlinks
stow home -t ~
```

## Usage

### Adding a config file

```bash
# Example: ~/.zshrc
mv ~/.zshrc home/.zshrc
stow -R home -t ~

# Verify
ls -la ~/.zshrc  # should show symlink
```

### Adding a config directory

```bash
# Example: ~/.config/alacritty
mkdir -p home/.config
mv ~/.config/alacritty home/.config/alacritty
stow -R home -t ~
```

### Removing a config

```bash
# Remove from dotfiles
rm home/.zshrc
stow -R home -t ~
```

### Updating symlinks

After any change to the `home/` structure:

```bash
stow -R home -t ~
```

### Preview changes

```bash
stow -n home -t ~
```

## Commands Reference

| Command             | Description               |
| ------------------- | ------------------------- |
| `stow home -t ~`    | Create symlinks           |
| `stow -D home -t ~` | Remove all symlinks       |
| `stow -R home -t ~` | Restow (refresh symlinks) |
| `stow -n home -t ~` | Dry run                   |

## What's Included

- **Neovim** - LazyVim config with VSCode-Neovim support
- **Claude Code** - Global instructions, settings, agents, skills
- **Ghostty** - Terminal config
- **Ripgrep** - Search config

## Notes

- If target files exist, stow will error. Back them up and remove first.
- Edits to symlinked files (e.g., `~/.config/nvim/`) edit this repo directly.
