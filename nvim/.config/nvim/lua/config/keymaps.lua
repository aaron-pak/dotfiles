-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Keymaps for both configs

vim.keymap.set("i", "jk", "<Esc>", { silent = true, desc = "Escape to normal mode" })

-- Specific keymaps for each environment
if vim.g.vscode then
  require("config.vscode_keymaps")
else
  require("config.nvim_keymaps")
end
