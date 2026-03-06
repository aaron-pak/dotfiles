---
name: next-task
description: "Execute task or tasks from a markdown plan or JSON task list. Implements a single iteration of a progress-tracked workflow. Use when: (1) working through a multi-task plan, (2) need structured progress tracking, (3) want atomic task completion with verification. Invoke with `/next-task @{plan-or-tasklist}`."
---

# Next Task

## Configuration

<progress-file>.claude/aaron/progress.txt</progress-file>

Execute task or tasks from a plan/task list with progress tracking and verification.

**Required:** User must provide a plan/task list file (e.g., `@plan.md` or `@tasks.json`).

**Tip:** Use `/task-list @{plan.md}` to generate a JSON task list from a markdown plan.

## CRITICAL: Sequential Task Processing

**Default: Execute exactly 1 task, then stop.** Only process multiple tasks if user explicitly requests (e.g., "next 5 tasks").

**Each task must complete the full workflow (steps 1-7) before starting the next.**

When multiple tasks requested:
1. Complete full workflow for task 1
2. Output brief completion summary
3. Restart from step 1 for task 2
4. Repeat until all requested tasks done or user interrupts

**Never:**
- Read multiple tasks before claiming one
- Implement multiple tasks before updating progress
- Batch status updates at the end
- Skip workflow steps to process tasks faster

One task, one full cycle. Then the next.

## Workflow

### 1. Understand Current State

- Read `<progress-file>` if exists - **apply patterns from 'Codebase Patterns' section**
- Read user-provided plan/task list
- If git repo: check recent history with `git log --oneline -10`

### 2. Select and Claim Next Task

**CRITICAL: Do NOT simply pick the next task in list order.** Evaluate ALL pending tasks and select the highest priority one.

**Priority factors:** blocking impact, category, project state, task context. Category is a heuristic (`architecture` > `integration` > `spike` > `feature` > `polish`), not a rule—a `polish` task on critical path may outrank `architecture` for a non-blocking module.

Identify the highest priority incomplete task:
- **Markdown:** highest priority task not yet logged in `<progress-file>`
- **JSON:** highest priority task with `status: "pending"` and all `blockedBy` resolved

**Before any implementation:** Set `status: "in_progress"` (JSON) or note selection (Markdown).

### 3. Initialize Progress (if needed)

Create `<progress-file>` if it doesn't exist:

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

Append to `<progress-file>`:

```markdown
## Task - [task.id if applicable]
- What was implemented
- Files changed
- **Learnings:** patterns, gotchas, blockers, notes
```

If you discover a reusable pattern, also add to ## Codebase Patterns at the TOP.

**If more tasks requested:** Output brief completion summary, then **return to Step 1** for next task.

## Completion Signal

When all tasks complete (markdown: all tasks logged in `<progress-file>`; JSON: all `status: "completed"`):

Output: `<tasks>COMPLETE</tasks>`

<user-request>
$ARGUMENTS
</user-request>