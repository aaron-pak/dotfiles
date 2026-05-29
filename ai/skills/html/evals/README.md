# /html skill evals

Browser-driven regression evals for the `/html` skill's review affordance
(highlight text → inline comment → edit → delete → export). The skill
*generates* the UI, so its behavior can't be read off `SKILL.md` and can drift
silently — both when you change the wording and when the underlying model
changes. These evals are how you check it still works.

Run them **on a trigger**, not continuously: when you change the skill, or after
a model upgrade. Each run is several headless-browser sessions.

## Setup (once)

```
cd ai/skills/html/evals
npm run setup        # npm install + downloads a headless Chromium
```

## How it works

An eval has two stages, because the first is stochastic and the second isn't:

1. **Generate** (model step): run the `/html` skill on a subject and save the
   artifact. This is the thing under test, so its output varies run to run —
   generate a few per eval to get a pass *rate*, not a single pass/fail.
2. **Verify** (this harness): drive the artifact in a real browser and grade
   objective checks.

### 1. Generate artifacts

For each active eval, run the `/html` skill on its `subject` and save the
HTML under `artifacts/<evalId>/` (e.g. `r1.html`, `r2.html`, …; more files =
larger sample). Get the exact prompts with:

```
node run.js --prompts
```

Then hand each to Claude with the skill. (Generation needs a model; the harness
deliberately doesn't do it.)

### 2. Verify

```
npm run smoke              # the one eval flagged "smoke" — fast canary
npm run verify             # all active evals
node run.js --eval <id>    # a single eval
```

Prints a per-eval pass/fail table and writes a full transcript to
`results/<timestamp>.json`.

## Two verification modes

- **Generic (this `run.js`)** — fast, no model needed. It *discovers* each
  artifact's comment UI heuristically (find the composer, click Save, locate the
  highlight, etc.). Reliable for the common popover-style UI; **best-effort**
  otherwise. A red result may be the verifier failing to find a control, not a
  real regression — see Limitations.
- **Agent-driven (authoritative)** — for full regression runs, or any artifact
  the generic driver mis-reads: have Claude read the artifact and drive it via
  `lib.js` (`probe`, `dragSelect`, `dragSelectRange`, and the helpers), adapting
  to that artifact's actual selectors. This is how the suite was first
  validated and is the source of truth when generic and agent disagree.

## Adding a new eval (keep the old ones)

When you spot a new failure or behavior worth guarding:

1. Add a subject file under `subjects/` (or reuse one).
2. Add an entry to `evals.json`:
   ```json
   {
     "id": "my-case", "name": "What it guards", "status": "active",
     "kind": "markdown spec", "subject": "subjects/my-case.md",
     "selection": "a phrase that appears in the subject",
     "crossSelection": { "start": "plain words", "end": "into `code`" },
     "checks": ["select", "anchor", "crossAnchor", "edit", "delete", "export"],
     "driver": "standard.js", "added": "YYYY-MM-DD", "notes": "why this exists"
   }
   ```
3. Generate artifacts for it and run. Old evals keep running unchanged — that's
   the regression suite.

Set `"status": "retired"` to mothball an eval without deleting its history.
Most cases need no new code — `standard.js` is parameterized by the registry.
For an exotic behavior, copy `standard.js`, adjust it, and point the eval's
`driver` at the new file; existing evals are unaffected.

### Checks

`select` (comment attaches to a selection), `anchor` (highlight wraps the exact
selected words within one element), `crossAnchor` (highlight survives a
selection crossing inline formatting — needs `crossSelection`), `edit`, `delete`,
`export` (single copy control emits the comment). List only the ones that matter
for a case — e.g. `diff-line` omits `anchor` on purpose (line-level commenting on
a diff is acceptable).

## Limitations (read before trusting a red)

- **Heuristic discovery.** The generic verifier guesses each artifact's controls.
  It's solid on the standard popover UI but **under-reports** when a control is
  hidden behind an unusual interaction or when the artifact renders only a quote
  (not the comment text) in the page body. Known current misses: `edit` on
  line-level diff UIs and on quote-only sidebars. Confirm any surprising red with
  the agent-driven mode before treating it as a regression.
- **Small N is noisy.** Generation is stochastic; read pass *rates*, and
  generate enough artifacts (≥3–5) before concluding a rate changed.
- **No false-green bias.** Checks are written to fail when unsure rather than
  pass — a green is trustworthy; a red may just need the agent-driven mode.

## Layout

```
evals/
  README.md        this file
  package.json     playwright dep + scripts (setup / verify / smoke)
  lib.js           the engine: probe() + selection/clipboard/UI helpers (reusable)
  evals.json       the case registry — grow this over time
  subjects/        content rendered by the skill, one per eval
  drivers/         standard.js (parameterized) + any custom drivers
  run.js           orchestrator: runs drivers, prints table, writes results/
  artifacts/       generated HTML (gitignored)
  results/         run transcripts (gitignored)
```
