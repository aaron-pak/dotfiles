# CLI - Dotfiles Manager

Effect-based CLI for managing dotfiles - syncing, checking differences, and initializing on new devices.

## Dev Scripts

```bash
bun run dev          # Run CLI in development
bun run build        # Compile TypeScript to dist/
bun run build:bin    # Compile native binary to ../dot
bun run typecheck    # Type check without emitting
bun run test         # Run tests (vitest)
bun run format       # Format with prettier
bun run format:check # Check formatting
```

## CLI Commands

- `sync` - Sync dotfiles via stow, handles conflicts interactively
- `add <path>...` - Move file from ~/ to home/, run stow (-n for dry-run)
- `remove` - [not implemented]
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

- Use `bun run src/main.ts` to run directly
- Use `@effect/platform-bun` for file system, process operations
- Bun automatically loads `.env` files

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
