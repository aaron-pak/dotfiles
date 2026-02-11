# CLAUDE.md

## Code Quality Standards

- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Maximize type inference**: Prefer inferred types over explicit annotations. Only annotate when the compiler cannot infer or when an explicit type genuinely improves readability (e.g., function return types on public APIs).

## Code Organization

Favor cohesion — proximity in code should reflect relatedness in purpose. When organizing or writing code, optimize for the reader who needs to understand or modify a single behavior.

## Plans

- At the end of each plan, ask the user a list of unresolved questions to answer, if any.
