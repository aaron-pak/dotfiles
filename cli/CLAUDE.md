# CLI

Source in `cli/src/`, tests in `cli/tests/`, config at repo root. Run `bun` commands from root.

## Commands

- `sync` - Sync dotfiles via stow, handles conflicts interactively
- `add <path>...` - Move file from ~/ to home/, run stow (-n for dry-run)
- `remove <path>...` - Remove symlink, move file back to ~/ (-n for dry-run)
- `init` - Bootstrap new machine: install Homebrew, packages, sync dotfiles, pull Claude settings (`--skip-brew` to skip Homebrew phase)
- `claude pull` - Pull shared settings into ~/.claude/settings.json (-n for dry-run)
- `claude push` - Push local shared-key values back to shared file (-n for dry-run)
- `claude share <key>` - Start sharing a top-level settings key
- `claude unshare <key>` - Stop sharing a top-level settings key

## Structure

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

## Bun Runtime

- Use `@effect/platform-bun` for file system, process operations
- Bun automatically loads `.env` files
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
