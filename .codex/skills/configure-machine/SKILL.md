---
name: configure-machine
description: Configure Aaron's Mac, dotfiles, global agent instructions, or personal skill installations using this repository. Use for setup, installing or removing a personal skill, and repairing configuration links. Ordinary application development does not need this skill.
---

# Configure this machine

Use this repository as the source of owned files and personal skills. Adapt the work to the user's request and the machine you are actually running on.

Read the repository's root `AGENTS.md` for ownership and commands. Locate the repository from this skill's path: it lives at `.codex/skills/configure-machine/SKILL.md`. If this is an installed symlink, resolve it to the canonical source first. The stable checkout is normally `~/projects/dotfiles`; confirm its status and the live links before installing. Never install links into the real home from an ephemeral worktree.

## Choose what to change

- Owned application config: edit its native file under `home/`. If it is already linked, the edit is already live. Use `bun run dev link <home-relative-file>` for a missing link. Inspect local files and compare contents before resolving a conflict.
- Shared global instructions: edit `home/.codex/AGENTS.md`. The global `home/.claude/CLAUDE.md` imports it; keep Claude-only additions in that wrapper. Root `AGENTS.md` describes this repository and must not become the global instruction file.
- Personal skill: its canonical directory is `.codex/skills/<name>/`. Installation is an individual link for the selected harness. There is no global installation manifest or blanket skill synchronization.
- Harness setting, MCP connection, or plugin: inspect and configure the installed harness locally with its own supported tools or scoped file edits. Keep settings, credentials, plugin caches, and generated runtime wiring out of this repository. Do not copy a plugin-owned skill into the personal library just to install the plugin.
- Package: update `Brewfile` if it should be part of the portable setup, and use Homebrew to install it on the selected machine.

Do not require users to choose a CLI command. Carry out the requested configuration and report the concrete result.

## Personal skills

Use the exact skill identity requested. Similar names and a plugin with a similar purpose are not interchangeable.

To install an existing skill from the stable checkout:

```sh
bun run dev skill eli5 --tool codex --dry
bun run dev skill eli5 --tool codex
```

Use `--tool claude` for Claude. The helper preserves the real `~/.codex/skills` and `~/.claude/skills` directories and refuses conflicting destinations. A conflict is evidence to inspect, not permission to delete the existing skill.

To add a personal skill to the library, inspect its full directory, then copy or create it under `.codex/skills/<name>/`. Preserve its supporting resources and attribution. Use the harness's skill-creator guidance when authoring or changing a skill. If adopting a local copy, verify the canonical copy before replacing that local directory with a link. Keep a backup when replacing user files.

To uninstall, verify that the specific destination is a symlink to the expected canonical skill and unlink only that destination. Keep the library copy and other installations. Removing a skill from the repository is a separate user intent; identify other installed links before removing its source.

Keep skill-specific scripts and references beside their `SKILL.md`, with explicit instructions for when to use them. Put a helper in root `scripts/` only when multiple operations share it. Do not create scripts for shell operations that need no extra logic.

## Existing machine or new Mac

For a repair, inspect only the relevant files and installations first. For a new-machine setup, inspect the OS, installed harnesses, Homebrew, Bun, and existing dotfiles. Install missing prerequisites through their official installers; use `brew bundle --file <repo>/Brewfile` for this repository's packages. Let the user complete authentication when required.

Run `bun install` in the stable checkout. Preview all owned dotfiles with `bun run dev sync --dry` before an initial setup. Resolve reported conflicts using actual file differences and the user's intent, preserving unique local content. Then run `bun run dev sync`. The command has no prompts and applies only `home/`; it does not install skills or configure harness settings.

Install `configure-machine` for the harnesses the user wants to use for future configuration work. Choose other personal skills from the user's request or existing installed state. Do not assume every skill in the repository belongs on every machine. Preserve intentionally absent skills during a repair.

Configure harness defaults directly when requested. There is no settings baseline to apply or maintain in Git.

## Verify the result

- Resolve installed file and skill links to the stable checkout. Check that app home directories remain real local directories.
- Confirm the shared global instructions are nonempty and Claude's import resolves without a cycle.
- Check actual discovery in the intended harness. Codex app-server `skills/list` with the relevant `cwds` and `forceReload: true` can verify discovery without a model run; the installed harness supports repository `.codex/skills`. For Claude Code, inspect its skill list and `/context` or its initialization output. A fresh session may be needed to pick up changed instructions.
- For owned dotfiles, repeat the scoped dry run or full Stow preview to check convergence. Test the application's relevant behavior when practical.
- Run the root verification commands when changing helper code. Report installation targets, preserved backups, tests, and anything still requiring user action. Do not present a file existing on disk as proof the harness loaded it.
