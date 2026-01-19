return {
  {
    "rachartier/tiny-inline-diagnostic.nvim",
    event = "VeryLazy",
    priority = 1000,
    opts = {
      preset = "modern",
      options = {
        add_messages = {
          display_count = true,
          messages = true,
        },
        multilines = {
          always_show = true,
          enabled = true,
        },
      }
    },
    vscode = false,
  },
  {
    "neovim/nvim-lspconfig",
    opts = { diagnostics = { virtual_text = false } },
    vscode = false,
  },
}
