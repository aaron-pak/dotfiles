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
- Read user-provided plan/task list
- If git repo: check recent history with `git log --oneline -10`

### 2. Select and Claim Next Task

Identify the next highest priority incomplete task:
- **Markdown:** highest priority task not yet logged in progress.txt
- **JSON:** highest priority task with `status: "pending"` and all `blockedBy` resolved

**Priority factors:** blocking impact, category, project state, task context. Category is a heuristic (`architecture` > `integration` > `spike` > `feature` > `polish`), not a rule—a `polish` task on critical path may outrank `architecture` for a non-blocking module.

**Before any implementation:** Set `status: "in_progress"` (JSON) or note selection (Markdown).

### 3. Initialize Progress (if needed)

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

### 4. Implement Task

Work on the task until verification steps pass.

### 5. Run Feedback Loops

Run applicable checks (type checking, tests, linting, formatting).

Fix issues until all pass.

### 6. Update Task List (JSON only)

Set `status: "completed"` for the task.

### 7. Update Progress

Append to `.claude/progress.txt`:

```markdown
## Task - [task.id if applicable]
- What was implemented
- Files changed
- **Learnings:** patterns, gotchas, blockers, notes
```

If you discover a reusable pattern, also add to ## Codebase Patterns at the TOP.

### 8. Signal Completion

When all tasks complete (markdown: all tasks logged in `.claude/progress.txt`; JSON: all `status: "completed"`):

Output: `<tasks>COMPLETE</tasks>`

<user-request>
$ARGUMENTS
</user-request>