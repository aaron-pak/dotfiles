---
name: "dynamic-workflows"
description: "Plan and run Claude Code-style dynamic workflows in Codex by coordinating many subagents through explicit phases, saved workflow manifests, progress tracking, verification, and resumable state. Use when the user asks for a dynamic workflow, workflow, ultracode-like run, multi-agent fan-out, codebase-wide audit or migration, large research synthesis with cross-checking, or high-risk work that should be independently verified."
---

# Dynamic Workflows for Codex

## Overview

Emulate Claude Code dynamic workflows inside Codex. Codex does not have Claude's JavaScript workflow runtime, so move the orchestration into explicit durable state, spawn subagents with the multi-agent tools, track progress from that state, and verify before returning results.

For long, reusable, or resumable runs, use `scripts/workflow-state.mjs` as the runtime substitute. It writes `workflow.json`, `journal.jsonl`, generated `workflow.md`/`status.md`, and `outputs/`; it does not spawn agents for you. The coordinator still launches Codex subagents and records their lifecycle in the ledger.

For Claude Code fidelity details, read `references/claude-dynamic-workflows.md` only when modifying this skill, explaining compatibility, or translating a saved Claude workflow.

When changing this skill, run the regression suite in `evals/`: `node evals/run.js --validate`, `node evals/run.js --fixtures`, `node evals/run.js --runtime`, and, after fresh forward-test artifacts are saved, `node evals/run.js`.

## Triage

Use a workflow when the task benefits from parallelism, independent review, or durable orchestration:

- Codebase-wide audits, migrations, cleanup sweeps, or bug hunts.
- Research that needs multiple source angles plus adversarial cross-checking.
- High-risk plans where independent proposals and reviewers should converge.
- Reusable multi-step procedures the user may want to save and rerun.

Do normal Codex work when the task is small, sequential, hard to split safely, or when the next local step depends on one blocking discovery.

If multi-agent tools are not visible, call `tool_search` for multi-agent or subagent tools before falling back. If no subagent tool exists, run the workflow sequentially and state that the Codex harness cannot fan out in this session.

If the user provides Claude workflow JavaScript, translate its primitives before launching:

- `export const meta` -> workflow name, description, and phases.
- `args` -> the user-provided task input.
- `phase("Name")` -> a phase boundary.
- `agent(prompt, { label, phase, schema })` -> one Codex subagent with a bounded output contract.
- `parallel([...])` -> concurrent agents inside the current phase.
- `pipeline(...)` -> ordered phases where later prompts use earlier outputs.
- `log(...)` -> progress notes in chat or the saved manifest.

For a JS file or pasted JS large enough to be error-prone, write it to a temporary file and run `node scripts/workflow-state.mjs translate-js <file> --out <run-dir>` to seed the Codex run state.

## Launch

Before spawning substantial work, write a launch brief:

- Workflow name and user goal.
- Phases, with the agents in each phase and what each returns.
- Concurrency cap. Default to 3-8 agents; use 9-16 only when the task clearly warrants it.
- Write scopes for worker agents. Keep write sets disjoint.
- Verification plan and final acceptance criteria.
- Whether run state will be saved.

Ask for approval before launching a high-token fan-out, making broad edits, or running external side effects unless the user already explicitly authorized that level of execution.

For long or reusable runs, save ledger-backed state before execution:

- One-off run state: `.codex/workflows/runs/<run-id>/workflow.json`
- Event journal: `.codex/workflows/runs/<run-id>/journal.jsonl`
- Generated views: `.codex/workflows/runs/<run-id>/workflow.md` and `status.md`
- Agent outputs: `.codex/workflows/runs/<run-id>/outputs/<agent>.md`
- Project reusable workflow template: `.codex/workflows/<name>.json`
- Personal reusable workflow template: `~/.codex/workflows/<name>.json`

Saved workflows are not real Codex slash commands. When the user asks to run one, find the template, create fresh run state from it, adapt it to the current repo, and execute it with this skill. Do not copy completed agent outputs into reusable templates.

Useful ledger commands:

```bash
node scripts/workflow-state.mjs init --name "<name>" --goal "<goal>" --phase "Discover" --phase "Verify" --out .codex/workflows/runs/<run-id>
node scripts/workflow-state.mjs add-agent .codex/workflows/runs/<run-id>/workflow.json --phase "Discover" --label auth-scan --scope packages/auth --prompt "<bounded prompt>"
node scripts/workflow-state.mjs start-agent .codex/workflows/runs/<run-id>/workflow.json --label auth-scan --agent-id <codex-agent-id>
node scripts/workflow-state.mjs finish-agent .codex/workflows/runs/<run-id>/workflow.json --label auth-scan --output outputs/auth-scan.md --summary "<short result>"
node scripts/workflow-state.mjs resume .codex/workflows/runs/<run-id>/workflow.json
node scripts/workflow-state.mjs status .codex/workflows/runs/<run-id>/workflow.json
```

## Execute

Run phases in order. Within a phase, spawn independent agents in parallel where the harness allows.

For each agent prompt, include only what it needs:

- Overall goal.
- This agent's bounded task and output format.
- Relevant files, directories, or sources.
- Constraints, including write scope for workers.
- Verification steps it owns.

For worker agents, state that they are not alone in the codebase, must not revert others' edits, and must adapt to concurrent changes. For explorer agents, ask for evidence with file paths, commands, sources, or confidence notes.

While agents run, keep doing coordinator work that does not duplicate their assignments. Use `wait_agent` only when the next step needs the result. Close agents when their outputs have been integrated.

For ledger-backed runs:

- Record each launched agent with `start-agent` once you have its id.
- Save each completed agent's useful output under `outputs/`, then run `finish-agent`.
- Use `fail-agent` for failed or unusable outputs; do not mark them reusable.
- Treat `journal.jsonl` as the source of truth. `workflow.md` and `status.md` are generated views.
- Use `status` for progress updates instead of hand-writing checklist state.
- Later phases are treated as consuming earlier phase outputs unless an explicit `dependsOn` graph narrows that relationship.

Do not stop at workflow theater. If the user authorized launch and no approval boundary blocks the run, spawn the planned agents, update progress, integrate outputs, and verify. If you only produce a plan, state the boundary that stopped execution.

## Cross-Check

Do not treat subagent output as ground truth. Use one or more of these patterns before finalizing:

- Independent duplicate attempts, then compare convergence and disagreements.
- Reviewer agents that try to refute findings or break an implementation.
- Deterministic verification with tests, linters, typechecks, browser checks, or source citations.
- Coordinator inspection of the final diff and behavior.

For code changes, the coordinator owns final verification. Inspect the diff, run the relevant checks, and state anything not verified.

## Resume

When resuming a workflow:

1. Read `workflow.json` and derive progress from `journal.jsonl`; trust the journal over generated Markdown if they disagree.
2. Run `node scripts/workflow-state.mjs resume <workflow.json>`.
3. Reuse completed outputs whose cache keys are still valid.
4. Mark changed prompt/scope/dependency outputs or missing output files as stale; rerun stale or missing work only.
5. Resume known agents by id if the harness still has them.
6. Spawn only dependency-ready work. Do not start verifier agents until required scan outputs exist.
7. Regenerate status before reporting progress.

Saved state should be enough to reconstruct progress: phase status, agent labels and ids when available, output locations and hashes, cache keys, verification status, and what work is missing, failed, blocked, or stale.

If no manifest exists, reconstruct the smallest useful state from chat, git diff, and available agent ids, then continue.

## Limits

- Codex does not execute Claude workflow JavaScript. Translate JS-style workflows into phases and agent prompts.
- Codex has no `/workflows` progress UI. Report concise status tables in chat and, for long runs, in the manifest.
- `scripts/workflow-state.mjs` is a state manager, not a background runtime. It cannot keep work running while this Codex turn is stopped.
- Avoid pretending saved workflows are automatically discoverable slash commands.
- Do not spawn hundreds of agents. Prefer 3-12, with 16 as the practical ceiling unless the current harness explicitly supports more and the user wants it.
- If a phase needs user sign-off, end the workflow at that boundary and launch the next phase after approval.
