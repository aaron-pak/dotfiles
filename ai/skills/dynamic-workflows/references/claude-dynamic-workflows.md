# Claude Code Dynamic Workflows Baseline

This reference preserves the behavior this Codex skill is trying to emulate. Use it when explaining fidelity, translating Claude workflow scripts, or improving the skill.

## Official behavior checked 2026-05-30

Primary docs:

- https://code.claude.com/docs/en/workflows
- https://claude.com/blog/introducing-dynamic-workflows-in-claude-code

Claude Code describes a dynamic workflow as a JavaScript script that coordinates subagents outside the main conversation. The script holds loops, branches, and intermediate results, while the final result returns to the user.

Launch paths:

- Include `workflow` in the prompt.
- Use `/effort ultracode` so Claude decides when a workflow is warranted.
- Run a bundled workflow such as `/deep-research`.
- Run a previously saved workflow command.

Key runtime claims:

- Built for dozens to hundreds of agents, with docs stating up to 16 concurrent agents and 1,000 total agents per run.
- Workflow scripts do not directly read files, write files, or run shell commands; agents do that work.
- Workflows have no mid-run user input. Split phases into separate workflows when sign-off is required.
- Progress can be inspected from `/workflows`.
- A paused run can resume in the same Claude Code session; completed agents return cached results.
- Saved workflows live in `.claude/workflows/` for a project or `~/.claude/workflows/` for personal use.

Approval and settings:

- The first launch can require confirmation and can show the raw script.
- `disableWorkflows`, `workflowKeywordTriggerEnabled`, and `ultracode` exist as settings.
- `CLAUDE_CODE_DISABLE_WORKFLOWS=1` disables workflows at startup.

## Local CLI probe

Machine probe:

- CLI: `/Users/aaronpak/.local/bin/claude`
- Version: `2.1.158 (Claude Code)`
- Probe date: 2026-05-30
- Probe command shape: `claude -p --verbose --permission-mode bypassPermissions --max-budget-usd 0.25 --output-format stream-json <prompt>`

The tools list included `Workflow`. A minimal prompt caused Claude to call it with this script shape:

```js
export const meta = {
  name: 'ping-pong',
  description: 'Single-phase, single-agent workflow where the agent only answers "pong"',
  phases: [
    { title: 'Ping', detail: 'one agent answers pong' },
  ],
}

phase('Ping')
const reply = await agent(
  'Respond with exactly the single word: pong. Do not read files, write files, or run any shell commands. Output only that one word as your final answer.',
  { label: 'pong' }
)
return { reply }
```

Persisted real workflows under `~/.claude/projects/.../workflows/scripts/*.js` show a larger primitive set:

- `args` as a global input value.
- `phase("Name")` for progress boundaries.
- `agent(prompt, { label, phase, schema })` for structured subagent calls.
- `parallel([...])` for fan-out.
- `pipeline(...)` for ordered stages.
- `log(...)` for workflow progress notes.
- JSON schemas passed into agents for structured results.

The bundled `deep-research` workflow used five phases: scope, search, fetch, verify, synthesize. One observed completed run used 101 agents, about 2.73M tokens, 602 tool calls, and about 10.6 minutes. Its verification stage used three independent votes per claim and required two refutations to discard a claim.

A persisted Palace workflow showed the codebase-migration shape: a constant file list, one `parallel(FILES.map(...agent...))` fan-out, each agent restricted to one file, structured result schema, then aggregate counts in the return object.

Default print mode produced a permission denial with `Review dynamic workflow before running`. Bypass mode launched the workflow in the background.

The successful tool result exposed these fields:

- `taskId`
- `runId`
- `summary`
- `transcriptDir`
- `scriptPath`
- resume instruction using `Workflow({ scriptPath, resumeFromRunId })`

The completed run JSON contained:

- `runId`, `taskId`, `script`, `scriptPath`, `result`, `agentCount`, `durationMs`, `workflowName`, `status`
- `phases`
- `defaultModel`
- `workflowProgress`
- `totalTokens`
- `totalToolCalls`

The workflow subagent transcript directory contained:

- `agent-<id>.meta.json`
- `agent-<id>.jsonl`
- `journal.jsonl`

The journal cached agent work as `started` and `result` events keyed by a deterministic-looking hash, which explains same-session resume behavior.

## Binary string clues

`strings` on `/Users/aaronpak/.local/share/claude/versions/2.1.158` showed workflow implementation identifiers including:

- `WorkflowTool`
- `LocalWorkflowTask`
- `loadPluginWorkflows`
- `workflowPermissionDialog`
- `recordWorkflowUsageConsent`
- `updateWorkflowProgressBatch`
- `pauseWorkflowTask`
- `killWorkflowTask`
- `retryWorkflowAgent`
- `skipWorkflowAgent`
- `resumeFromRunId`

It also exposed script restrictions:

- `Date.now() / new Date() are unavailable in workflow scripts (breaks resume).`
- `Math.random() is unavailable in workflow scripts (breaks resume).`

## Codex emulation target

Codex can reproduce the important workflow shape, but not the exact runtime:

- Use a manifest instead of executable workflow JavaScript.
- Use the current Codex harness's subagent spawn tool as the `agent(...)` primitive. In this session, that tool was `multi_agent_v1.spawn_agent`; other sessions may need `tool_search` discovery first.
- Use ordered phases and a coordinator-managed concurrency cap.
- Save run state in `.codex/workflows/runs/` when resumption matters.
- Save reusable manifests in `.codex/workflows/` or `~/.codex/workflows/`.
- Use chat status tables instead of Claude's `/workflows` UI.
- Use saved outputs and agent ids as the resume cache.
