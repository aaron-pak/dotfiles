# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a LazyVim-based Neovim configuration that supports both standalone Neovim and VSCode-Neovim environments. The configuration uses [lazy.nvim](https://github.com/folke/lazy.nvim) as the plugin manager and builds on [LazyVim](https://github.com/LazyVim/LazyVim) as a base configuration.

## Architecture

### Entry Point
- `init.lua` - Bootstraps lazy.nvim and loads `config.lazy`

### Configuration Structure (`lua/config/`)
- `lazy.lua` - Plugin manager setup, imports LazyVim base + custom plugins from `lua/plugins/`
- `options.lua` - Neovim options (extends LazyVim defaults)
- `keymaps.lua` - Shared keymaps for both environments, loads environment-specific keymaps:
  - `nvim_keymaps.lua` - Standalone Neovim keymaps
  - `vscode_keymaps.lua` - VSCode-Neovim keymaps (maps to VSCode commands via `vscode.action()`)
- `autocmds.lua` - Autocommands (extends LazyVim defaults)

### Plugins (`lua/plugins/`)
Each file returns a plugin spec table for lazy.nvim. Key pattern: use `vscode = false` to disable a plugin in VSCode, `vscode = true` to only enable in VSCode.

- `appearence.lua` - Colorschemes (tokyonight with transparency, catppuccin)
- `blink-cmp.lua` - Completion configuration with VSCode-like keybindings
- `vscode.lua` - vscode-multi-cursor plugin (only loads in VSCode)
- `snacks.lua` - folke/snacks.nvim configuration
- `noice.lua` - folke/noice.nvim UI replacement (cmdline, messages, popupmenu)
- `flash.lua` - folke/flash.nvim navigation
- `tiny-inline-diagnostic.lua` - rachartier/tiny-inline-diagnostic.nvim
- `example.lua` - Example spec (disabled via `if true then return {} end`)

### Environment Detection
`vim.g.vscode` is used throughout to detect VSCode-Neovim environment:
```lua
if vim.g.vscode then
  -- VSCode-specific code
else
  -- Standalone Neovim code
end
```

## Key Customizations

- `jk` mapped to Escape in insert mode (both environments)
- `<C-u>/<C-d>` centered after scroll (Neovim only)
- Transparent backgrounds enabled for tokyonight theme
- blink.cmp uses "super-tab" preset with Tab/Enter for accepting completions
