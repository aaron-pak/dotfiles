# CLAUDE.md

Dotfiles managed with GNU Stow. `home/` mirrors `~` and gets symlinked.

## CLI

Effect-based dotfiles manager. Source in `cli/src/`, tests in `cli/tests/`, config at repo root.

**Always use `dot` (or `bun run dev`) for all dotfile operations — never run `stow` directly.** The CLI sets the correct target (`~/`) and handles conflicts, backups, and edge cases that raw stow commands won't.

```bash
bun install          # install deps
bun run build        # compile to ./dot binary
bun run dev          # run without compiling
bun run test         # run tests (vitest, not bun test)
bun run test:e2e:ai  # run AI end-to-end CLI checks in isolated temp homes
bun run typecheck    # type check
```

Warnings are not acceptable. Before finishing work, `bun run typecheck` and `bun run test` must both pass cleanly with no warnings and no failures.

### Commands

- `sync` - Sync dotfiles via stow, then pull managed Claude and Codex settings
- `add <path>...` - Move file from ~/ to home/, run stow (-n for dry-run)
- `remove <path>...` - Remove symlink, move file back to ~/ (-n for dry-run)
- `init` - Bootstrap new machine: install Homebrew, packages, sync dotfiles, then pull Claude and Codex settings (`--skip-brew` to skip Homebrew phase)
- `ai` - Open the interactive AI management hub
- `ai help` - Show AI command help
- `ai settings pull [--tool claude|codex|all]` - Pull shared settings into local AI config files
- `ai settings adopt <name> --tool claude|codex` - Copy one local key/section into the repo-owned shared file
- `ai settings ignore <name> --tool claude|codex` - Keep this machine's current value on the next pull or sync
- `ai settings unignore <name> --tool claude|codex` - Resume applying the shared value on the next pull or sync
- `ai skills` - Open the interactive skills manager
- `ai skills sync` - Project managed skills onto this machine
- `ai skills adopt [<name>] [--from claude|codex|agents|<path>] [--targets claude,codex,agents]` - Adopt one local skill into managed storage
- `ai skills unmanage <name>` - Stop managing one skill and keep local copies on this machine
- `ai skills list` - List managed skills and their targets

### Source Structure

```
cli/src/
├── main.ts           # CLI entry, layer composition
├── commands/         # add, remove, sync, init, ai
└── services/
    ├── Stow.ts          # dryRun, sync, resolveConflicts, addDotfile, removeDotfile
    ├── StowConfig.ts    # dotfilesRoot, homeDir paths
    ├── Homebrew.ts      # checkInstalled, install, bundle, bundleDryRun
    ├── AiState.ts       # structural AI config metadata and skill projections
    ├── AiLocalState.ts  # machine-local ignored shared sections
    ├── ClaudeSettings.ts # pull, adopt, ignore, unignore
    └── CodexSettings.ts  # pull, adopt, ignore, unignore
cli/tests/
```

## Configs

### Claude Code (`home/.claude/`)

Synced via stow: `CLAUDE.md`, `agents/`, `statusline-command.sh`

Not synced (machine-specific): `settings.json`, `cache/`, `plugins/`, `history.jsonl`

**Settings sync:** `~/.claude/settings.json` is NOT symlinked. `ai/claude-settings-shared.json` is the shared file, and `dot ai settings pull --tool claude` or `dot sync` applies every top-level key from that file into the local settings file except keys this machine has been told to keep locally in `~/.config/dot/ai-local.toml`. Local-only keys such as `enabledPlugins` stay local. If a key stops being shared, machines keep the value they already have.

### Managed Skills (`ai/skills/`)

Managed skills live outside `home/` now. Each managed skill has one canonical repo copy under `ai/skills/<name>/`, and `dot ai skills sync` or `dot sync` projects symlinks into the selected local surfaces:

- `~/.claude/skills/<name>`
- `~/.codex/skills/<name>`
- `~/.agents/skills/<name>`

`dot ai skills unmanage` only guarantees safe local preservation on the machine where the command runs in v1.

`dot ai` opens the interactive AI hub, and `dot ai skills` opens the interactive skills manager directly. Toggling a target there updates `ai/state.toml` immediately, updates this machine immediately, and `dot sync` removes deselected managed symlinks on other machines after they pull. If you unmanage skills from the interactive manager, it asks whether this machine should keep local copies or delete them.

The repo no longer stows `home/.claude/skills`, `home/.codex/skills`, or `home/.agents`. Those live skill surfaces are local directories managed only by the AI skill projector.

### Codex (`home/.codex/`)

Synced via stow: `AGENTS.md`

Not synced (machine-specific): `config.toml`, auth, history, caches, worktrees, SQLite state, and other runtime artifacts.

**Instruction source:** `home/.codex/AGENTS.md` is a symlink to `home/.claude/CLAUDE.md`, which is the canonical global instruction file for all tools.

**Settings sync:** `~/.codex/config.toml` is NOT symlinked. `ai/codex-settings-shared.toml` is the shared file, and `dot ai settings pull --tool codex` or `dot sync` applies every top-level section from that file into the local config except sections this machine has been told to keep locally in `~/.config/dot/ai-local.toml`. `projects` always remains local and is never adopted or pulled from shared state. If a section stops being shared, machines keep the value they already have.

## AI Ownership Model

`ai/state.toml` is structural metadata only. It declares:

- the canonical global instruction file
- which repo file owns the shared settings for each tool
- which managed skills exist and which local surfaces they target

The repo intentionally keeps actual content in native files and directories rather than in a database or one synthetic state blob.

The model is split by behavior:

- `tools.*.settings` for per-key shared settings
- `skills.<name>` for whole-skill management with explicit targets

Normal operator vocabulary:

- `shared file` - repo-owned source of truth for shared settings values
- `pull` - apply the shared file into the live local config
- `adopt` - promote one local live setting into the shared file
- `ignore` - tell one machine to keep its own value on future pulls/syncs
- `unignore` - tell one machine to start using the shared value again on future pulls/syncs
- `managed skill` - one canonical repo copy projected into selected local AI surfaces

### Tmux (`home/.tmux.conf`)

Synced via stow. Catppuccin Mocha status bar on neutral dark background. Pane labels show the running command (burnt orange active, dim inactive). Nerd Font icons from `nf-md-*` range only.

**Claude Code process name fix:** Claude Code runs from `~/.local/share/claude/versions/<semver>/`, so macOS uses the version number (e.g. `2.1.50`) as the process name. The config uses `#{s/^[0-9][0-9.]*$/claude/:pane_current_command}` to replace any semver-shaped command with `claude`. This is applied in both pane labels and window list formats.

### Ghostty (`home/.config/ghostty/config`)

Synced via stow. Uses Cursor Dark theme (Nord palette on `#141414` background). Nerd Font icons: only Material Design range (U+F0000+, `nf-md-*`) renders reliably via font fallback — other ranges may not display.

### Neovim (`home/.config/nvim/`)

LazyVim-based, supports standalone + VSCode-Neovim. See `home/.config/nvim/CLAUDE.md`.

## Brewfile

Located at repo root. Format: `brew "pkg"`, `cask "app"`. Run via `dot init`.

## Bun Runtime

- Use `@effect/platform-bun` for file system, process operations
- **Compiled binary:** `import.meta.dirname` returns virtual `/$bunfs/root/...` path. Use `path.dirname(process.argv[0])` for real path detection.

## Stow Behavior

- **Tree folding:** Stow symlinks entire directories when possible, not individual files
- Remove must handle both: dir symlink vs individual file symlinks inside

## Color Palette

Use **Catppuccin Mocha** as the default palette for all UI and config styling. User-specified overrides (e.g. burnt orange `#d08770` for tmux pane labels) take precedence — preserve them as-is during future changes.

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

**Override:** Prefer `Effect.Service` over `Context.Tag` (interface inferred, `.Default` auto-generated):

```typescript
class Foo extends Effect.Service<Foo>()("Foo", {
  effect: Effect.gen(function* () {
    return { bar: Effect.fn("Foo.bar")(function* () { ... }) }
  }),
}) {}
```

<!-- effect-solutions:end -->

## Effect Gotchas

- `Schema.TaggedError` subclasses need `override get message()` not `get message()`
- Layer composition: use `Layer.merge(A, B)` then `Layer.provideMerge(..., Dep)` when both need same dep

## Testing Patterns

- Avoid chained `Effect.provide` (TS18 warning) - use `Layer.provideMerge` to compose, then single `Effect.provide`
- `bun run test` - runs vitest (correct)
- `bun run test:e2e:ai` - builds `dot` and runs isolated AI CLI end-to-end checks with temp repo/home directories
- `bun test` - runs bun's test runner (wrong, causes @effect/vitest errors)
- Treat warnings as failures. Fix all warnings instead of ignoring or suppressing them.
- Do not consider work complete unless `bun run typecheck`, `bun run test`, and any relevant E2E checks all pass cleanly.

## Local Effect Source

The Effect repository is cloned to `~/opensource/effect/` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.
