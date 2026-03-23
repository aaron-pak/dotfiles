# Agent Instructions

## Code Standards

- Prefer inferred types over explicit types. When we rely on type inference, we can easily change type definitions without having to modify downstream code. Only use explicit types when defining core interfaces and abstractions or when we may want to reuse and compose the type.
- Prioritize high type safety. Don't use `any`, non-null assertion operator (`!`), or type assertions (`as Type`)
- Do not leave compiler, linter, test, or runtime warnings behind unless specified otherwise
- Favor cohesion. Proximity in code should reflect relatedness in purpose. When organizing or writing code, optimize for the reader who needs to understand or modify a single behavior.
- Establish clear boundaries. When creating core interfaces and abstractions, think carefully about the purpose of that piece of code and define boundaries based on purpose. Strive to create abstractions that are flexible, composable, and or extensible.
