---
name: next-task
description: "Execute the next task from a markdown plan or JSON task list. Implements a single iteration of a progress-tracked workflow. Use when: (1) working through a multi-task plan, (2) need structured progress tracking, (3) want atomic task completion with verification. Invoke with `/next-task @{plan-or-tasklist}`."
---

# Next Task

Execute one task from a plan/task list with progress tracking and verification.

**Required:** User must provide a plan/task list file (e.g., `@plan.md` or `@tasks.json`).

**Tip:** Use `/task-list @{plan.md}` to generate a JSON task list from a markdown plan.

## Workflow

### 1. Understand Current State

- Read `.claude/progress.txt` if exists - **apply patterns from 'Codebase Patterns' section**
- Read user-provided plan/task list - find next incomplete task:
  - **Markdown:** cross-reference with progress.txt to find first unlogged task
  - **JSON:** find tasks with `status: "pending"` AND all `blockedBy` tasks have `status: "completed"`
  - **Prioritization:** Category is one factor, not the answer. Weigh category + description + dependencies + what task touches + project state. A `polish` task on critical path may outrank an `architecture` task for a non-blocking module.
  - **Category priority heuristic:** `architecture` → `integration` → `spike` → `feature` → `polish`
- If git repo: check recent history with `git log --oneline -10`

### 2. Initialize Progress (if needed)

Create `.claude/progress.txt` if it doesn't exist:

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

Set `status: "in_progress"` (JSON only), then work on the task until verification steps pass.

### 4. Run Feedback Loops

Run applicable checks (type checking, tests, linting, formatting).

Fix issues until all pass.

### 5. Update Task List (JSON only)

Set `status: "completed"` for the task.

### 6. Update Progress

Append to `.claude/progress.txt`:

```markdown
## Task - [task.id if applicable]
- What was implemented
- Files changed
- **Learnings:** patterns, gotchas, blockers, notes
```

If you discover a reusable pattern, also add to ## Codebase Patterns at the TOP.

### 7. Signal Completion

When all tasks complete (markdown: all tasks logged in `.claude/progress.txt`; JSON: all `status: "completed"`):

Output: `<tasks>COMPLETE</tasks>`

<user-request>
$ARGUMENTS
</user-request>