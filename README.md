# Dotfiles

Personal dotfiles managed with the `dot` CLI, built on [GNU Stow](https://www.gnu.org/software/stow/) and [Effect](https://effect.website/).

## New Machine Setup

```bash
git clone <repo-url> ~/projects/dotfiles
cd ~/projects/dotfiles
bun install && bun run build
./dot ai help
./dot init
```

`dot init` will:

1. Install [Homebrew](https://brew.sh/) (if missing)
2. Install packages from `Brewfile` (stow, neovim, ripgrep, ghostty)
3. Sync dotfiles to `~` via GNU Stow (with interactive conflict resolution)
4. Pull shared Claude and Codex settings into local config files

Use `--skip-brew` to skip the Homebrew phase, or `-n` for a dry run.

## Commands

### Sync dotfiles

```bash
dot sync            # sync stowed files, then pull managed Claude/Codex settings
dot sync -n         # dry run
```

If conflicts are found (existing files where symlinks should go), you'll be prompted to backup, delete, or abort.

### Add a dotfile

```bash
dot add .zshrc              # moves ~/.zshrc into home/, restows
dot add .config/ghostty     # works with directories too
dot add -n .zshrc           # dry run
```

Paths are relative to `~`.

### Remove a dotfile

```bash
dot remove .zshrc           # removes symlink, moves file back to ~/
dot remove -n .zshrc        # dry run
```

### AI config model

`ai/state.toml` is structural metadata only. It defines:

- which instruction file is canonical
- which repo file owns each tool's shared settings
- which managed skills exist and where they should be projected

Actual content stays in native files:

- managed skills: `ai/skills/`
- global instructions: `home/.claude/` and `home/.codex/AGENTS.md`
- shared Claude settings: `ai/claude-settings-shared.json`
- shared Codex settings: `ai/codex-settings-shared.toml`

The live skill surfaces `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills` are no longer stowed from `home/`. They are local directories populated only by `dot ai skills sync` / `dot sync`.

`dot sync` invokes GNU Stow with `--no-folding`, so app homes and managed bins such as `~/.claude`, `~/.codex`, and `~/.local/bin` stay real local directories and only their managed entries are symlinked.

Local merged settings remain machine-specific:

- `~/.claude/settings.json`
- `~/.codex/config.toml`
- `~/.config/dot/ai-local.toml`

### Quick guide

- Change shared Claude settings for every machine:
  edit `ai/claude-settings-shared.json`, then run `dot ai settings pull --tool claude` or `dot sync`
- Change shared Codex settings for every machine:
  edit `ai/codex-settings-shared.toml`, then run `dot ai settings pull --tool codex` or `dot sync`
- Open the interactive AI manager:
  run `dot ai`
- Show AI help:
  run `dot ai help`
- Open the interactive skills manager directly:
  run `dot ai skills`
- Adopt a local skill into shared management:
  run `dot ai skills adopt`
- Stop managing a skill on the current machine:
  run `dot ai skills unmanage <name>`
- Change a machine-only override:
  edit the local tool file, not the repo-managed shared file
- Make a local value become the shared baseline:
  run `dot ai settings adopt <name> --tool claude` or `dot ai settings adopt <name> --tool codex`
- Tell one machine to keep its own value next time you sync:
  run `dot ai settings ignore <name> --tool claude` or `dot ai settings ignore <name> --tool codex`
- Tell one machine to start using the shared value again on the next sync:
  run `dot ai settings unignore <name> --tool claude` or `dot ai settings unignore <name> --tool codex`

### Claude Code settings

```bash
dot ai settings pull --tool claude
dot ai settings adopt <name> --tool claude
dot ai settings ignore <name> --tool claude
dot ai settings unignore <name> --tool claude
```

The shared file is `ai/claude-settings-shared.json`. `pull` applies every top-level key from that file unless this machine has been told to keep its own value in `~/.config/dot/ai-local.toml`. Local-only Claude keys stay untouched. If a key stops being shared in the repo, machines keep whatever value they already had.

### Codex settings

```bash
dot ai settings pull --tool codex
dot ai settings adopt <name> --tool codex
dot ai settings ignore <name> --tool codex
dot ai settings unignore <name> --tool codex
```

The shared file is `ai/codex-settings-shared.toml`. `pull` applies every top-level section from that file unless this machine has been told to keep its own value in `~/.config/dot/ai-local.toml`. `projects` always stays local. If a section stops being shared in the repo, machines keep whatever value they already had.

### Skills

Managed skills live in `ai/skills/<name>/`. `ai/state.toml` records each managed skill's canonical repo directory plus its selected targets: `claude`, `codex`, and/or `agents`.

Use these commands:

```bash
dot ai
dot ai skills
dot ai skills list
dot ai skills sync
dot ai skills adopt
dot ai skills adopt my-skill --from codex --targets claude,codex
dot ai skills unmanage my-skill
```

`dot ai` opens the interactive AI hub. `dot ai skills` opens the interactive skill manager directly so you can toggle Claude, Codex, and `.agents` on or off for each managed skill. If you unmanage skills from that menu, it asks whether this machine should keep local copies or delete them. `dot sync` and `dot init` also project managed skills automatically, including removing deselected managed symlinks on other machines after pull + sync. `dot ai skills unmanage` only guarantees safe local preservation on the machine where you run it in v1. Other machines are not guaranteed to keep a working copy after they pull that repo change.

## What's Included

| Config            | Path                      | Notes                                                        |
| ----------------- | ------------------------- | ------------------------------------------------------------ |
| Neovim            | `home/.config/nvim/`      | LazyVim with VSCode-Neovim support                           |
| Claude Code       | `home/.claude/`           | Canonical global instructions and statusline                 |
| Codex             | `home/.codex/`            | Repo only keeps `AGENTS.md`; runtime files always stay local |
| Managed AI skills | `ai/skills/`              | Canonical repo copy for whole-skill sharing                  |
| Ghostty           | `home/.config/ghostty/`   | Terminal config                                              |
| Karabiner         | `home/.config/karabiner/` | Main `karabiner.json` only; backups stay local               |
| Ripgrep           | `home/.config/ripgrep/`   | Search config                                                |

## Development

```bash
bun install          # install deps
bun run build        # compile to ./dot binary
bun run dev          # run without compiling (e.g. bun run dev sync -n)
bun run test         # run tests (vitest)
bun run test:e2e:ai  # run AI end-to-end CLI checks in isolated temp homes
bun run typecheck    # type check
```

Source is in `src/`. See `CLAUDE.md` for architecture and patterns.
