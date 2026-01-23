# CLI - Dotfiles Manager

Effect-based CLI for managing dotfiles - syncing, checking differences, and initializing on new devices.

## Build

Build outputs single `dot` binary to project root (gitignored). Never use `node` - always `bun`.

```bash
pnpm build           # Compile to ../dot binary
./dot sync --help    # Run the binary
```

## Dev Scripts

```bash
bun run dev          # Run CLI directly without compiling
pnpm test            # Run tests (vitest)
pnpm typecheck       # Type check without emitting
pnpm format          # Format with prettier
```

## CLI Commands

- `sync` - Sync dotfiles via stow, handles conflicts interactively
- `add <path>...` - Move file from ~/ to home/, run stow (-n for dry-run)
- `remove <path>...` - Remove symlink, move file back to ~/ (-n for dry-run)
- `init` - [not implemented]

## Project Structure

```
cli/
├── src/
│   ├── main.ts           # CLI entry, layer composition
│   ├── commands/         # add, remove, sync, init
│   └── services/
│       ├── Stow.ts       # dryRun, sync, resolveConflicts, addDotfile, checkAddable
│       └── StowConfig.ts # dotfilesRoot, homeDir paths
├── tests/
└── package.json
```

## Bun Runtime

- Use `bun run src/main.ts` for faster iteration (no rebuild)
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

## Testing Patterns

- Avoid chained `Effect.provide` (TS18 warning) - use `Layer.provideMerge` to compose, then single `Effect.provide`

## Local Effect Source

The Effect repository is cloned to `~/opensource/effect/` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.
