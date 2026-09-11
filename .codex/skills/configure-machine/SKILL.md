---
name: configure-machine
description: Maintain Aaron's dotfiles and global agent instructions, set up a Mac, or install personal skills for a selected tool at user or project scope. Ordinary application development does not need this skill.
---

# Configure this machine

Read the repository's root `AGENTS.md` for ownership. This skill lives at `.codex/skills/configure-machine/`; resolve an installed symlink to locate its source repository. The stable checkout is normally `~/projects/dotfiles`. Inspect its status and live links before installing; ongoing installations must not point into an ephemeral worktree.

## Choose the source and destination

- Application configuration lives under `home/`. An edit to an already-linked file is live. Inspect local files before adopting them or resolving conflicts. Choose individual files or wholly owned directories; keep app homes and skill discovery directories real. Skip repository documentation, Git metadata, and runtime files when selecting a new-machine installation.
- Shared global instructions live in `home/.codex/AGENTS.md`; the global Claude wrapper imports them. Root `AGENTS.md` and `CLAUDE.md` govern this repository.
- Distributable skills live in `skills/<name>/`. This maintenance skill stays in the repository's own discovery directories. Storage and installation are separate.
- Harness settings, MCP connections, and plugins are configured locally with supported tools or scoped edits. Keep credentials and generated wiring out of Git. Plugin-owned skills stay owned by their plugin.
- Portable packages belong in `Brewfile`; install them with Homebrew directly.

For a skill installation, determine the exact skill, intended tool(s), and user or project scope from the request and current context. Verify the selected harness's discovery directory on that machine. Both user and project installations are supported; do not substitute global installation for a project request. If material scope is ambiguous, clarify it rather than installing more broadly.

Link the entire skill directory so its scripts, references, and assets travel together. A link follows changes to the stable library. Use a copy when the project needs self-contained, versioned content that works on other machines; do not commit a machine-specific external link as a portable installation. Keep unrelated installations unchanged.

## Mechanical linking

Use [scripts/link.py](scripts/link.py) for an explicit source and destination. It uses only Python 3's standard library and knows nothing about harnesses, scopes, or repository layouts.

Examples from the stable checkout, after checking the chosen discovery locations:

```sh
# One native config file; preview first when useful.
python3 .codex/skills/configure-machine/scripts/link.py home/.tmux.conf ~/.tmux.conf --dry-run

# Install a library skill just for this user's Codex.
python3 .codex/skills/configure-machine/scripts/link.py skills/eli5 ~/.codex/skills/eli5

# Install just for Claude in one selected project.
python3 .codex/skills/configure-machine/scripts/link.py skills/artifact-design /absolute/project/.claude/skills/artifact-design
```

The helper leaves an existing correct link alone, refuses every other occupied destination (including broken links), and refuses to write through symlinked parents. It creates missing parent directories only on apply. It does not overwrite, back up, uninstall, recursively synchronize, or choose scope. Resolve a reported parent link or file conflict by inspecting the actual target and contents, not by forcing replacement. An already-correct link is accepted without mutation even beneath a linked directory.

Use ordinary filesystem operations for inspected copies, moves, and removals. Before replacing local content, preserve anything unique. To uninstall, verify and unlink only the selected installation; deleting the library source is a separate intent. Before moving or deleting a library skill, identify its installed links and update or remove those in the requested scope.

Keep scripts with the skill that uses them. Python, Node, or Bun are suitable when they make a helper clearer; verify the runtime on the selected machine. Add deterministic code for recurring mechanical work, leaving configuration decisions to the agent.

## New machine and verification

Inspect the OS, intended harnesses, Homebrew, and existing configuration. Install missing prerequisites as needed and use `brew bundle --file <repo>/Brewfile` for portable packages. Inspect `home/` to select the files needed, compare conflicts, and install explicit links. There is no recursive sync command or settings baseline. Choose skills from the request or existing installation intent, not the entire library.

After changes, check link targets, retained local content, and the application's relevant behavior. Verify actual skill discovery in the intended tool and scope: Codex app-server `skills/list` with the relevant `cwds` and `forceReload: true`, or Claude's skill list/initialization and `/context` for instruction imports. A fresh session may be required. For copied skills, also check supporting resources. Report the installations, scope, validation, and any unresolved user action.

When changing the helper, run the isolated tests in `tests/` using the root verification command.
