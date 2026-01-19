return {
  "vscode-neovim/vscode-multi-cursor.nvim",
  event = "VeryLazy",
  cond = function()
    return vim.g.vscode ~= nil
  end,
  opts = {},
  vscode = true,
}
