---
name: next-task
description: "Execute the next task from a markdown plan or JSON task list. Implements a single iteration of a progress-tracked workflow. Use when: (1) working through a multi-task plan, (2) need structured progress tracking, (3) want atomic task completion with verification. Invoke with `/next-task @{plan-or-tasklist}`."
---

# Next Task

Execute one task from a plan/task list with progress tracking and verification.

**Required:** User must provide a plan/task list file (e.g., `@plan.md` or `@tasks.json`).

## Workflow

### 1. Understand Current State

- Read `progress.txt` if exists - **apply patterns from 'Codebase Patterns' section**
- Read user-provided plan/task list - find next incomplete task:
  - **Markdown:** cross-reference with progress.txt to find first unlogged task
  - **JSON:** look for `passes: false`
  - **Priority** (high→low): architecture → integration points → spikes → features → polish
- Check recent history: `git log --oneline -10`

### 2. Initialize Progress (if needed)

Create `progress.txt` if it doesn't exist:

```markdown
# Progress Log
Feature: <name of plan or task list>
Started: <YYYY-MM-DD>

## Codebase Patterns
<!-- Consolidate reusable patterns here -->

---
<!-- Task logs below - APPEND ONLY -->
```

### 3. Implement Task

Work on the single task until verification steps pass.

### 4. Run Feedback Loops

Run applicable checks (type checking, tests, linting, formatting). Commands per project CLAUDE.md.

Fix issues until all pass.

### 5. Update Task List (JSON only)

If working from a JSON task list, set the task's `passes` field to `true`.

### 6. Update Progress

Append to progress.txt:

```markdown
## Task - [task.id if applicable]
- What was implemented
- Files changed
- **Learnings:** patterns, gotchas, blockers, notes
```

### 7. Signal Completion

When all tasks complete (markdown: all tasks logged in progress.txt; JSON: all `passes: true`):

Output: `<tasks>COMPLETE</tasks>`

<user-request>
$ARGUMENTS
</user-request>