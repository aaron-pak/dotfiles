# CLAUDE.md

Dotfiles managed with GNU Stow. `home/` mirrors `~` and gets symlinked.

## CLI

Effect-based dotfiles manager. Source in `cli/src/`, tests in `cli/tests/`, config at repo root.

```bash
bun install          # install deps
bun run build        # compile to ./dot binary
bun run dev          # run without compiling
bun run test         # run tests (vitest, not bun test)
bun run typecheck    # type check
```

### Commands

- `sync` - Sync dotfiles via stow, handles conflicts interactively
- `add <path>...` - Move file from ~/ to home/, run stow (-n for dry-run)
- `remove <path>...` - Remove symlink, move file back to ~/ (-n for dry-run)
- `init` - Bootstrap new machine: install Homebrew, packages, sync dotfiles, pull Claude settings (`--skip-brew` to skip Homebrew phase)
- `claude pull` - Pull shared settings into ~/.claude/settings.json (-n for dry-run)
- `claude push` - Push local shared-key values back to shared file (-n for dry-run)
- `claude share <key>` - Start sharing a top-level settings key
- `claude unshare <key>` - Stop sharing a top-level settings key

### Source Structure

```
cli/src/
├── main.ts           # CLI entry, layer composition
├── commands/         # add, remove, sync, init, claude
└── services/
    ├── Stow.ts          # dryRun, sync, resolveConflicts, addDotfile, removeDotfile
    ├── StowConfig.ts    # dotfilesRoot, homeDir paths
    ├── Homebrew.ts      # checkInstalled, install, bundle, bundleDryRun
    └── ClaudeSettings.ts # pull, push, share, unshare
cli/tests/
```

## Configs

### Claude Code (`home/.claude/`)

Synced via stow: `CLAUDE.md`, `agents/`, `skills/`, `statusline-command.sh`

Not synced (machine-specific): `settings.json`, `cache/`, `plugins/`, `history.jsonl`

**Settings sync:** `~/.claude/settings.json` is NOT symlinked. Instead, shared settings live in `config/claude-settings-shared.json` and are selectively merged into each machine's local `settings.json` via the CLI. Only top-level keys present in the shared file are synced. Machine-specific keys (e.g., `enabledPlugins`) are never touched by pull.

### Agents (`home/.agents/`)

Synced via stow. Standard `.agents` directory used by [skills.sh](https://skills.sh). Skills installed here are bridged to Claude Code via relative symlinks in `home/.claude/skills/<skill>` → `../../.agents/skills/<skill>`.

**Stow + relative symlinks:** Stow tree-folds directories into the repo, so relative symlinks inside resolve from the repo path, not `~/`. Both sides of a cross-directory relative symlink must live within `home/` for the link to resolve correctly.

### Tmux (`home/.tmux.conf`)

Synced via stow. Nord-accented status bar styled to match the Cursor Dark Ghostty theme. Pane labels show the running command with active/inactive distinction (burnt orange label, light gray border).

**Claude Code process name fix:** Claude Code runs from `~/.local/share/claude/versions/<semver>/`, so macOS uses the version number (e.g. `2.1.50`) as the process name. The config uses `#{s/^[0-9][0-9.]*$/claude/:pane_current_command}` to replace any semver-shaped command with `claude`. This is applied in both pane labels and window list formats.

### Ghostty (`~/.config/ghostty/config`)

Not stow-managed. Uses Cursor Dark theme (Nord palette on `#141414` background). Nerd Font icons: only Material Design range (U+F0000+, `nf-md-*`) renders reliably via font fallback — other ranges may not display.

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
- `bun test` - runs bun's test runner (wrong, causes @effect/vitest errors)

## Local Effect Source

The Effect repository is cloned to `~/opensource/effect/` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.
