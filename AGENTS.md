# Dotfiles

This repository holds Aaron's native dotfiles, global agent instructions, and distributable personal skills. Work with the user conversationally.

For machine setup, installing a skill, repairing links, or changing agent configuration, use `.codex/skills/configure-machine/SKILL.md`.

## Ownership

- `home/` mirrors `~/` and contains native configuration we own. Inspect and link the selected files or wholly owned directories; it is not a blanket installation manifest.
- `home/.codex/AGENTS.md` owns shared global instructions. `home/.claude/CLAUDE.md` imports it and may add Claude-only guidance.
- Root `AGENTS.md` describes this repository. Root `CLAUDE.md` imports it. Neither is the global instruction file.
- `.codex/skills/configure-machine/` is this repository's maintenance skill; `.claude/skills/configure-machine` links to it for Claude discovery.
- `skills/<name>/` is the distributable library. Storage does not activate a skill. Install separately for the requested tool and user or project scope. A project installation must not silently become a global installation.
- Settings, plugins, credentials, caches, sessions, and generated harness wiring stay local. There is no shared-settings baseline or installation registry.
- `Brewfile` records portable Homebrew packages. Use Homebrew directly.

The stable checkout is normally `~/projects/dotfiles`. Inspect Git status and live links before changing it. Links installed for ongoing use must point to a stable checkout, not an ephemeral worktree. Preserve existing local edits when integrating work.

## Filesystem operations

There is no dedicated dotfiles CLI or Stow dependency. The agent chooses sources and destinations and resolves conflicts from actual file contents. Use the standard-library Python helper `.codex/skills/configure-machine/scripts/link.py` when creating a link: it previews, treats an existing correct link as a no-op, and refuses occupied destinations or symlinked parents. See the skill for examples and scope decisions.

Keep real directories for app homes such as `~/.codex` and `~/.claude`, and for skill discovery directories. Native shell/file operations are appropriate for inspected copies, moves, and unlinks; preserve unique local content before replacing it. Removing one installation must not delete its library source or other installations.

## Verification

Run the helper's isolated filesystem tests after changing it:

```sh
python3 -W error -m unittest discover -s .codex/skills/configure-machine/tests -v
git diff --check
```

Tests must pass without warnings or failures. They cover file and directory links, arbitrary project destinations, previews, conflicts, and symlinked parents using temporary directories. There is no TypeScript build or package installation step.

After installation, verify link targets and actual discovery in the intended harness and scope. Report what changed and anything still requiring user action. For application configuration, check the relevant behavior when practical.

## Config details worth preserving

- Tmux: Catppuccin Mocha with a neutral dark background and burnt orange `#d08770` active labels. Keep the semver-shaped process-name substitution that displays Claude as `claude`.
- Ghostty: preserve the user's current theme and colors. Only Material Design Nerd Font icons (`nf-md-*`, U+F0000+) render reliably through fallback.
- Karabiner: only `karabiner.json` is managed; automatic backups and assets stay local. Device vendor/product IDs may differ on another machine.
- Neovim: read `home/.config/nvim/CLAUDE.md` before changing its configuration.
- Use Catppuccin Mocha for new terminal/config styling unless the user requests otherwise. Existing overrides take precedence; the user's global HTML artifact preferences apply to HTML.
