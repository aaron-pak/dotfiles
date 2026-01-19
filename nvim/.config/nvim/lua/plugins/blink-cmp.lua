return {
  "saghen/blink.cmp",
  opts = {
    completion = {
      list = {
        selection = {
          -- Don't auto-select first item
          preselect = true,
          -- Don't auto-insert text when navigating through completions
          auto_insert = false,
        },
      },
    },
    keymap = {
      -- Use 'super-tab' preset as base for VSCode-like behavior
      preset = "super-tab",

      -- Show/hide completion menu
      ["<C-space>"] = { "show", "show_documentation", "hide_documentation" },
      ["<C-e>"] = { "hide", "fallback" },

      -- Tab accepts completion (or moves to next snippet placeholder)
      ["<Tab>"] = {
        function(cmp)
          if cmp.snippet_active() then
            return cmp.accept()
          else
            return cmp.select_and_accept()
          end
        end,
        "snippet_forward",
        "fallback",
      },

      ["<S-Tab>"] = { "snippet_backward", "fallback" },

      -- Enter also accepts completion
      ["<CR>"] = { "accept", "fallback" },

      -- Navigate completions with arrow keys or Ctrl+n/p
      ["<Up>"] = { "select_prev", "fallback" },
      ["<Down>"] = { "select_next", "fallback" },
      ["<C-p>"] = { "select_prev", "fallback_to_mappings" },
      ["<C-n>"] = { "select_next", "fallback_to_mappings" },

      ['<C-b>'] = { 'scroll_documentation_up', 'fallback' },
      ['<C-f>'] = { 'scroll_documentation_down', 'fallback' },

      ['<C-k>'] = { 'show_signature', 'hide_signature', 'fallback' },
    },
  },
  vscode = false,
}
