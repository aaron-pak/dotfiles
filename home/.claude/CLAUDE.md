# Global AI Instructions

## Code Quality Standards

- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Maximize type inference**: Prefer inferred types over explicit annotations. Only annotate when the compiler cannot infer or when an explicit type genuinely improves readability (e.g., function return types on public APIs).
- **Warnings are failures**: Do not leave compiler, linter, test, or runtime warnings behind. Finish with clean checks only.
- **Checks must pass**: `bun run typecheck` and `bun run test` must both pass before considering work complete.

## Code Organization

Favor cohesion — proximity in code should reflect relatedness in purpose. When organizing or writing code, optimize for the reader who needs to understand or modify a single behavior.

## Plans

- End plans with unresolved questions only when there are real unresolved questions.
