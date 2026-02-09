# CLAUDE.md

## Code Quality Standards

- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Maximize type inference**: Prefer inferred types over explicit annotations. Only annotate when the compiler cannot infer or when an explicit type genuinely improves readability (e.g., function return types on public APIs).

### **ENTROPY REMINDER**

This codebase will outlive you. Every shortcut you take becomes
someone else's burden. Every hack compounds into technical debt
that slows the whole team down.

You are not just writing code. You are shaping the future of this
project. The patterns you establish will be copied. The corners
you cut will be cut again.

**Fight entropy. Leave the codebase better than you found it.**

## Plans

- At the end of each plan, interview me with a list of unresolved questions to answer, if any.
