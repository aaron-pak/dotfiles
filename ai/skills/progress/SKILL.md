---
name: progress
description: "Track work progress with structured logging. Use when: (1) user says 'track progress' or 'start tracking' before beginning work, (2) user says 'update progress' or 'log progress' after completing work, (3) user wants persistent learnings across sessions. Invoke with `/progress start` or `/progress update`."
---

# Progress Tracker

## Configuration

<progress-file>.claude/aaron/progress.txt</progress-file>

Maintain a progress log at `<progress-file>` to capture what was done, files changed, and learnings.

**Modes:**
- `start` - Initialize progress file before beginning work
- `update` - Log completed work and learnings

## Mode: Start

Initialize or prepare progress tracking before work begins.

### Workflow

1. **Check existing progress:** Read `<progress-file>` if exists
   - Apply any patterns from "Codebase Patterns" section to current work
   - Review recent entries for context

2. **Create if needed:**

```markdown
# Progress Log
Feature: <describe work being tracked>
Started: <YYYY-MM-DD>

## Codebase Patterns
<!-- Consolidate reusable patterns here -->

---
<!-- Task logs below - APPEND ONLY -->
```

3. **Output:** Confirm tracking initialized, summarize any existing patterns to apply

## Mode: Update

Log completed work after a task or session.

### Workflow

1. **Gather info:** If user didn't specify, ask:
   - What was implemented?
   - Which files changed?
   - Any learnings, gotchas, or blockers?

2. **Append entry to `<progress-file>`:**

```markdown
## Task - <brief title>
- What was implemented
- Files changed
- **Learnings:** patterns, gotchas, blockers, notes
```

3. **Extract patterns:** If a reusable pattern emerged, also add to `## Codebase Patterns` at TOP of file

4. **Output:** Confirm logged, highlight any new patterns added

## Arguments

Parse `$ARGUMENTS`:
- `start` or empty → Mode: Start
- `update` → Mode: Update
- Any other text → Infer mode from context (mentions of "done", "completed", "finished" → update; otherwise → start)

<user-request>
$ARGUMENTS
</user-request>
