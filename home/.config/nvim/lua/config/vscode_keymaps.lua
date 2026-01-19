local vscode = require("vscode")

local opts = { noremap = true, silent = true }

local function action(command)
    return function() vscode.action(command) end
end

-- MULTICURSOR
vim.keymap.set('n', '<C-n>', 'mciw*<Cmd>nohl<CR>', { remap = true })

-- CODE ACTIONS
vim.keymap.set('n', '<leader>cr', action('editor.action.rename'), opts)
vim.keymap.set('n', '<leader>co', action('editor.action.organizeImports'), opts)
vim.keymap.set('n', '<leader>cf', action('editor.action.formatDocument'), opts)
vim.keymap.set('v', '<leader>cf', action('editor.action.formatSelection'), opts)
vim.keymap.set('n', '<leader>ca', action('editor.action.quickFix'), opts)

-- LSP NAVIGATION
vim.keymap.set('n', 'gd', action('editor.action.revealDefinition'), opts)
vim.keymap.set('n', 'gr', action('editor.action.goToReferences'), opts)
vim.keymap.set('n', 'gI', action('editor.action.goToImplementation'), opts)
vim.keymap.set('n', 'gy', action('editor.action.goToTypeDefinition'), opts)
vim.keymap.set('n', 'gD', action('editor.action.revealDeclaration'), opts)
vim.keymap.set('n', 'gK', action('editor.action.signatureHelp'), opts)

-- DIAGNOSTICS
vim.keymap.set('n', ']e', action('editor.action.marker.next'), opts)
vim.keymap.set('n', '[e', action('editor.action.marker.prev'), opts)

-- FIND/FILE
vim.keymap.set('n', '<leader>ff', action('workbench.action.quickOpen'), opts)
vim.keymap.set('n', '<leader><space>', action('workbench.action.quickOpen'), opts)
vim.keymap.set('n', '<leader>fr', action('workbench.action.showAllEditorsByMostRecentlyUsed'), opts)
-- vim.keymap.set('n', '<leader>fb', action('workbench.action.showAllEditorsByMostRecentlyUsed'), opts)
vim.keymap.set('n', '<leader>fn', action('workbench.action.files.newUntitledFile'), opts)

-- SEARCH
vim.keymap.set('n', '<leader>sg', action('workbench.action.findInFiles'), opts)
vim.keymap.set('n', '<leader>sw', action('workbench.action.findInFiles'), opts)
vim.keymap.set('n', '<leader>sG', action('workbench.action.findInFiles'), opts)
vim.keymap.set('n', '<leader>sb', action('actions.find'), opts)
vim.keymap.set('n', '<leader>sc', action('workbench.action.showCommands'), opts)

-- EXPLORER
vim.keymap.set('n', '<leader>ue', action('workbench.action.toggleSidebarVisibility'), opts)
vim.keymap.set('n', '<leader>e', action('workbench.view.explorer'), opts)
vim.keymap.set('n', '<leader>fe', action('workbench.view.explorer'), opts)
vim.keymap.set('n', '<leader>gg', action('workbench.view.scm'), opts)

-- Buffers
vim.keymap.set('n', '[b', action('workbench.action.previousEditorInGroup'), opts)
vim.keymap.set('n', ']b', action('workbench.action.nextEditorInGroup'), opts)
vim.keymap.set('n', '[B', action('workbench.action.moveEditorLeftInGroup'), opts)
vim.keymap.set('n', ']B', action('workbench.action.moveEditorRightInGroup'), opts)
vim.keymap.set('n', '<leader>bb', action('workbench.action.quickOpenPreviousRecentlyUsedEditor'), opts)
vim.keymap.set('n', '<leader>`', action('workbench.action.quickOpenPreviousRecentlyUsedEditor'), opts)
vim.keymap.set('n', '<leader>bd', action('workbench.action.closeActiveEditor'), opts)
vim.keymap.set('n', '<leader>bo', action('workbench.action.closeOtherEditors'), opts)
vim.keymap.set('n', '<leader>bD', action('workbench.action.closeActiveEditor'), opts)

-- Toggle pin/unpin editor based on current state
local function toggle_pin_editor()
    vscode.eval_async([[
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (activeTab.isPinned) {
            await vscode.commands.executeCommand('workbench.action.unpinEditor');
        } else {
            await vscode.commands.executeCommand('workbench.action.pinEditor');
        }
    ]])
end
vim.keymap.set('n', '<leader>bp', toggle_pin_editor, opts)

-- Multiple Windows
vim.keymap.set('n', '<leader>-', action('workbench.action.splitEditorDown'), opts)
vim.keymap.set('n', '<leader>|', action('workbench.action.splitEditorRight'), opts)
vim.keymap.set('n', '<leader>wd', action('workbench.action.closeEditorsInGroup'), opts)

-- User
vim.keymap.set('n', '<leader>us', action('cSpell.addIssuesToDictionary'), opts)
-- vim.keymap.set('n', '<leader>ud', action('cSpell.removeIssuesFromDictionary'), opts)

-- AI (Cursor)
-- vim.keymap.set('n', '<leader>ai', action('vscode-ai.cursorSuggest'), opts)
vim.keymap.set('n', '<leader>aa', action('composerMode.agent'), opts)
vim.keymap.set('n', '<leader>ac', action('composerMode.chat'), opts)
