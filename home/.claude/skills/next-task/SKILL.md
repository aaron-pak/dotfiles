---
name: next-task
description: "Execute the next task from a markdown plan or JSON task list. Implements a single iteration of a progress-tracked workflow. Use when: (1) working through a multi-task plan, (2) need structured progress tracking, (3) want atomic task completion with verification. Invoke with `/next-task @{plan-or-tasklist}`."
---

# Next Task

Execute one task from a plan/task list with progress tracking and verification.

## Workflow

### 1. Understand Current State

- Read progress file - **CHECK 'Codebase Patterns' SECTION FIRST**
- Read PRD - find the next incomplete task by priority
  - For JSON task lists, look for `passes: false`
  - **Task Priority** (highest to lowest):
    1. Architecture/core abstractions
    2. Integration points
    3. Spikes/unknowns
    4. Standard features
    5. Polish/cleanup
- Check recent history (git: `git log --oneline -10`)

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

Work on the selected task until verification passes. Follow codebase patterns from progress.txt.

### 4. Run Feedback Loops

Run all applicable checks:
- Type checking
- Tests
- Linting
- Formatting

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

If entire plan is implemented or all tasks are complete, output

Output: `<tasks>COMPLETE</tasks>`

<user-request>
$ARGUMENTS
</user-request>