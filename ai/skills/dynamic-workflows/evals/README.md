# dynamic-workflows skill evals

Agent-driven regression evals for the `dynamic-workflows` Codex skill.

The skill coordinates subagents through the Codex harness, so the model-driven
step cannot be fully replayed by a local script. This harness does the repeatable
part: it prints scenario prompts for fresh forward-test agents, grades the saved
outputs against objective workflow-behavior checks, and runs deterministic checks
against the bundled state ledger.

## Run

```bash
cd ai/skills/dynamic-workflows/evals
node run.js --prompts          # print exact forward-test prompts
node run.js --validate         # registry sanity checks
node run.js --fixtures         # self-test the grader on included fixtures
node run.js --smoke --fixtures # one fast fixture canary
node run.js --runtime          # deterministic workflow-state.mjs checks
node run.js                   # grade saved artifacts
node run.js --eval translate-js
```

## Workflow

1. Run `node run.js --prompts`.
2. For each scenario, send the printed prompt to a fresh agent with access to
   the skill.
3. Save each final answer as `artifacts/<scenario-id>/r1.md`, `r2.md`, etc.
4. Run `node run.js` to grade all saved artifacts.
5. Inspect any failed checks, improve `SKILL.md` or references, then repeat.

Keep old scenarios. Add new scenarios when a failure mode appears, so the suite
becomes a regression guard instead of a one-off review.

## What The Checks Mean

- `must`: required text or regex pattern.
- `mustNot`: forbidden text or regex pattern.
- `ordered`: terms that must appear in order.
- `countAtLeast`: a regex must appear at least N times.

These checks are intentionally concrete. They do not prove the workflow would
execute perfectly, but they catch the common failure modes: pretending Codex has
Claude's JS runtime, skipping approval, losing resume semantics, doing broad
fan-out for tiny tasks, or forgetting adversarial verification.

## Subagent Orchestration Plan

Use three layers when evaluating a skill change:

1. **Rubric / adversarial pass.** Ask one independent agent to read the skill
   and argue what would make the replication untrustworthy. Convert its
   concrete failure modes into scenario checks.
2. **Forward-test pass.** Send the printed prompts to fresh agents with the
   skill attached. Keep each prompt task-like; do not tell the agent what checks
   must pass. Save final answers under `artifacts/<scenario-id>/`.
3. **Verifier pass.** Run this deterministic harness. For any failure, inspect
   the saved output, revise the skill or reference, and repeat the affected
   scenario with a fresh agent.

For broad revisions, cover at least: tiny-task triage, Claude JS translation,
large fan-out planning, deep-research cross-checking, resume, missing subagent
fallback, and risky side effects.
