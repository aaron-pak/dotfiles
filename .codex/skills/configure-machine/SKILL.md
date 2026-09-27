---
name: configure-machine
description: Maintain Aaron's dotfiles and global agent instructions, set up a Mac, or install personal skill plugins for a selected tool at user or project scope. Ordinary application development does not need this skill.
---

# Configure this machine

Read the repository's root `AGENTS.md` for ownership. This skill lives at `.codex/skills/configure-machine/`; resolve an installed symlink to locate its source repository. The stable checkout is normally `~/projects/dotfiles`. Inspect its status and live links before installing; ongoing installations must not point into an ephemeral worktree.

## Choose the source and destination

- Application configuration lives under `home/`. An edit to an already-linked file is live. Inspect local files before adopting them or resolving conflicts. Choose individual files or wholly owned directories; keep app homes and skill discovery directories real. Skip repository documentation, Git metadata, and runtime files when selecting a new-machine installation.
- Shared global instructions live in `~/projects/agent-plugins/instructions/`: link `AGENTS.md` to `~/.codex/AGENTS.md` and the Claude wrapper `CLAUDE.md`, which imports it, to `~/.claude/CLAUDE.md`. Nothing installs them automatically. Root `AGENTS.md` and `CLAUDE.md` govern this repository.
- Personal skills are plugins in the `agent-plugins` marketplace ([aaron-pak/agent-plugins](https://github.com/aaron-pak/agent-plugins)), one plugin per skill. This maintenance skill stays in this repository's own discovery directories.
- Harness settings, MCP connections, and plugins are configured locally with supported tools or scoped edits. Keep credentials and generated wiring out of Git. Plugin-owned skills stay owned by their plugin.
- Portable packages belong in `Brewfile`; install them with Homebrew directly.

## Install a personal plugin

Determine the exact plugin, intended tool(s), and scope from the request and current context. Install only what was selected; do not substitute global installation for a project request. If material scope is ambiguous, clarify it rather than installing more broadly. Keep unrelated installations unchanged.

```sh
# Claude Code: scope is user, project, or local.
claude plugin marketplace add aaron-pak/agent-plugins
claude plugin install eli5@agent-plugins --scope user

# Codex: plugins install for the user.
codex plugin marketplace add aaron-pak/agent-plugins
codex plugin add eli5@agent-plugins
```

Check `claude plugin marketplace list` and `codex plugin marketplace list` first; a marketplace added once serves every install. Updates follow the Git commit: `claude plugin marketplace update agent-plugins` then `claude plugin update <plugin>@agent-plugins`, and `codex plugin marketplace upgrade agent-plugins`. Uninstall with `claude plugin uninstall` or `codex plugin remove`. A project that needs committed, self-contained skill content can copy the skill directory from `agent-plugins/plugins/<name>/skills/<name>/` instead.

## Mechanical linking

Use [scripts/link.py](scripts/link.py) for an explicit source and destination. It uses only Python 3's standard library and knows nothing about harnesses, scopes, or repository layouts.

Examples from the stable checkout, after checking the chosen discovery locations:

```sh
# One native config file; preview first when useful.
python3 .codex/skills/configure-machine/scripts/link.py home/.tmux.conf ~/.tmux.conf --dry-run

# Global instructions from the agent-plugins checkout.
python3 .codex/skills/configure-machine/scripts/link.py ~/projects/agent-plugins/instructions/AGENTS.md ~/.codex/AGENTS.md
python3 .codex/skills/configure-machine/scripts/link.py ~/projects/agent-plugins/instructions/CLAUDE.md ~/.claude/CLAUDE.md
```

The helper leaves an existing correct link alone, refuses every other occupied destination (including broken links), and refuses to write through symlinked parents. It creates missing parent directories only on apply. It does not overwrite, back up, uninstall, recursively synchronize, or choose scope. Resolve a reported parent link or file conflict by inspecting the actual target and contents, not by forcing replacement. An already-correct link is accepted without mutation even beneath a linked directory.

Use ordinary filesystem operations for inspected copies, moves, and removals. Before replacing local content, preserve anything unique. To remove a link, verify and unlink only the selected installation; deleting its source is a separate intent.

Keep scripts with the skill that uses them. Python, Node, or Bun are suitable when they make a helper clearer; verify the runtime on the selected machine. Add deterministic code for recurring mechanical work, leaving configuration decisions to the agent.

## New machine and verification

Inspect the OS, intended harnesses, Homebrew, and existing configuration. Install missing prerequisites as needed and use `brew bundle --file <repo>/Brewfile` for portable packages. Inspect `home/` to select the files needed, compare conflicts, and install explicit links. Clone `aaron-pak/agent-plugins` to `~/projects/agent-plugins` and link its `instructions/` files. There is no recursive sync command or settings baseline. Choose plugins from the request or existing installation intent, not the entire marketplace.

After changes, check link targets, retained local content, and the application's relevant behavior. Verify actual skill discovery in the intended tool and scope: Codex app-server `skills/list` with the relevant `cwds` and `forceReload: true` (plugin skills appear as `plugin:skill`), or Claude's `claude plugin list`, skill list/initialization, and `/context` for instruction imports. A fresh session may be required. For copied skills, also check supporting resources. Report the installations, scope, validation, and any unresolved user action.

When changing the helper, run the isolated tests in `tests/` using the root verification command.
