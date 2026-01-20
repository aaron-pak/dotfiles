# CLI - Dotfiles Manager

Effect-based CLI for managing dotfiles - syncing, checking differences, and initializing on new devices.

## Commands

```bash
bun run dev        # Run CLI in development
bun run build      # Compile TypeScript
bun run typecheck  # Type check without emitting
```

## Project Structure

```
cli/
├── src/
│   └── main.ts    # CLI entry point
├── dist/          # Compiled output
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
3. Search `~/opensource/effect/` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
