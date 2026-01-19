# Managing Dotfiles

This guide explains how to manage your dotfiles using GNU Stow.

## How It Works

The `home` directory mirrors your actual home directory structure. When you run `stow home -t ~`, it creates symlinks from your home directory pointing to files in this repo.

```
dotfiles/home/.config/nvim  →  ~/.config/nvim (symlink)
dotfiles/home/.claude/CLAUDE.md  →  ~/.claude/CLAUDE.md (symlink)
```

This means edits to `~/.config/nvim` are actually editing files in this repo.

## Adding New Config Files

### 1. Create the directory structure

Mirror the path from your home directory inside `home/`. For example:

| Home location | Dotfiles location |
|---------------|-------------------|
| `~/.zshrc` | `home/.zshrc` |
| `~/.config/git/config` | `home/.config/git/config` |
| `~/.ssh/config` | `home/.ssh/config` |

### 2. Move the file and restow

```bash
# Example: adding ~/.zshrc
cd ~/Projects/dotfiles

# Move the original file into the repo
mv ~/.zshrc home/.zshrc

# Restow to create the symlink
stow -R home -t ~
```

### 3. Verify the symlink

```bash
ls -la ~/.zshrc
# Should show: .zshrc -> Projects/dotfiles/home/.zshrc
```

### 4. Commit the changes

```bash
git add home/.zshrc
git commit -m "Add zshrc"
git push
```

## Adding a Directory

For directories like `~/.config/alacritty`:

```bash
cd ~/Projects/dotfiles

# Create parent directories if needed
mkdir -p home/.config

# Move the directory
mv ~/.config/alacritty home/.config/alacritty

# Restow
stow -R home -t ~

# Verify
ls -la ~/.config/alacritty
```

## Removing a Config

To stop managing a file:

```bash
# Unstow first
stow -D home -t ~

# Remove from repo
rm home/.zshrc

# Restow remaining configs
stow home -t ~

# Optionally restore original file
# (you'll need to recreate it or restore from backup)
```

## Common Commands

| Command | Description |
|---------|-------------|
| `stow home -t ~` | Create symlinks |
| `stow -D home -t ~` | Remove symlinks |
| `stow -R home -t ~` | Restow (remove and recreate symlinks) |
| `stow -n home -t ~` | Dry run (show what would happen) |

## Setting Up on a New Machine

```bash
# Clone the repo
git clone https://github.com/aaron-pak/dotfiles.git ~/Projects/dotfiles

# Install stow
brew install stow

# Create symlinks
cd ~/Projects/dotfiles
stow home -t ~
```

**Note:** If files already exist at the target locations, stow will refuse to overwrite them. Back up and remove existing files first, or use `--adopt` to pull existing files into the repo (use with caution).
