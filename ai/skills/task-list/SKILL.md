---
name: task-list
description: Break a markdown plan, feature, or task into a structured JSON task list for incremental implementation. Use when user asks to decompose a plan, feature, or task into a structured task list
---

# Task List Generator

## Configuration

<tasks-dir>.claude/aaron/tasks</tasks-dir>

Parse a markdown plan and generate a structured JSON task list optimized for incremental implementation by agents with fresh context.

## Invocation

```
/task-list @{plan.md}
```

## Process

1. Read the referenced plan file
2. Identify discrete implementation units
3. Break large units into smaller subtasks (flatten, no nesting)
4. Categorize each task
5. Generate verification steps
6. Write JSON to `<tasks-dir>/{plan-filename}.json`

## Output Format

```json
[
  {
    "id": "1",
    "category": "feature",
    "description": "Add POST /users endpoint for registration",
    "steps": [
      "Endpoint accepts email and password",
      "Returns 201 with user object on success",
      "Returns 400 on validation failure"
    ],
    "blocks": [],
    "blockedBy": [],
    "status": "pending"
  }
]
```

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier (string, sequential) |
| `description` | Task description. If referencing files, use full paths (relative from project root or absolute)—never bare filenames |
| `blocks` | Task IDs that cannot start until this completes |
| `blockedBy` | Task IDs that must complete before this can start |
| `status` | `pending` → `in_progress` → `completed` |

## Categories

Categories signal the *nature* of work to help agents reason about prioritization. They inform decisions but don't dictate—agents weigh category + description + what the task touches + project state.

| Category | Signals |
|----------|---------|
| `architecture` | Core abstractions, foundational design decisions |
| `integration` | Integration points, connecting systems/modules |
| `spike` | Unknowns, exploration, needs learning before committing |
| `feature` | Standard implementation work |
| `polish` | Cleanup, quick wins, refinement |

**General priority order:** `architecture` → `integration` → `spike` → `feature` → `polish`

## Task Granularity

Keep changes small and focused:
- One logical change per task
- If a task feels too large, break it into subtasks
- Prefer multiple small tasks over one large task
- Quality over speed—small steps compound into big progress

## Verification Steps

Write steps as concrete, observable checks:
- Prefer specific over vague ("Returns 404 for missing user" vs "Handles errors")
- Include happy path and key edge cases
- Keep to 3-5 steps per task

## Output Location

Create `<tasks-dir>` directory if needed. Name output file same as input:
- Input: `auth-plan.md` → Output: `<tasks-dir>/auth-plan.json`
- Input: `feature.md` → Output: `<tasks-dir>/feature.json`

**If output file already exists:** Stop and ask user whether to overwrite, merge, or abort.

## Example Transformation

**Input plan excerpt:**
```markdown
## Authentication
- Add login endpoint with JWT
- Add protected route middleware
- Create login form component
```

**Output:**
```json
[
  {
    "id": "1",
    "category": "architecture",
    "description": "Create JWT token generation utility",
    "steps": [
      "Generates signed JWT with user ID",
      "Token includes expiration claim",
      "Secret loaded from environment"
    ],
    "blocks": ["2", "3"],
    "blockedBy": [],
    "status": "pending"
  },
  {
    "id": "2",
    "category": "architecture",
    "description": "Add authentication middleware",
    "steps": [
      "Extracts token from Authorization header",
      "Validates token signature and expiration",
      "Attaches user to request context",
      "Returns 401 for invalid/missing token"
    ],
    "blocks": [],
    "blockedBy": ["1"],
    "status": "pending"
  },
  {
    "id": "3",
    "category": "feature",
    "description": "Add POST /auth/login endpoint",
    "steps": [
      "Accepts email and password in request body",
      "Returns JWT token on valid credentials",
      "Returns 401 on invalid credentials"
    ],
    "blocks": ["4"],
    "blockedBy": ["1"],
    "status": "pending"
  },
  {
    "id": "4",
    "category": "feature",
    "description": "Create login form component",
    "steps": [
      "Renders email and password inputs",
      "Submits credentials to login endpoint",
      "Displays error message on failure",
      "Redirects to dashboard on success"
    ],
    "blocks": [],
    "blockedBy": ["3"],
    "status": "pending"
  }
]
```

Note: JWT utility and middleware are `architecture` (core abstractions). Login endpoint and form are `feature` (standard implementation). Dependencies: JWT utility blocks middleware and login endpoint; login endpoint blocks form component.
