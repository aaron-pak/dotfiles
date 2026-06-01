#!/usr/bin/env node
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(ROOT);
const workflowState = path.join(skillRoot, "scripts", "workflow-state.mjs");
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, "scenarios.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

function selectedScenarios() {
  const id = opt("--eval");
  let selected = id ? scenarios.filter((scenario) => scenario.id === id) : scenarios.filter((scenario) => scenario.status === "active");
  if (flag("--smoke")) {
    const smoke = selected.filter((scenario) => scenario.smoke);
    selected = smoke.length ? smoke : selected.slice(0, 1);
  }
  return selected;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRegex(check) {
  return new RegExp(check.pattern || escapeRegExp(check.text), check.flags || "");
}

function toGlobalRegex(check) {
  const flags = check.flags || "";
  return new RegExp(check.pattern || escapeRegExp(check.text), flags.includes("g") ? flags : `${flags}g`);
}

function artifactPaths(id, rootDir = path.join(ROOT, "artifacts")) {
  const dir = path.join(rootDir, id);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".md") || file.endsWith(".txt"))
      .sort()
      .map((file) => path.join(dir, file));
  }
  const single = path.join(rootDir, `${id}.md`);
  return fs.existsSync(single) ? [single] : [];
}

function evaluateCheck(check, text) {
  if (check.type === "must") {
    return { passed: toRegex(check).test(text) };
  }
  if (check.type === "mustNot") {
    return { passed: !toRegex(check).test(text) };
  }
  if (check.type === "ordered") {
    let offset = 0;
    for (const term of check.terms) {
      const found = text.toLowerCase().indexOf(term.toLowerCase(), offset);
      if (found === -1) return { passed: false, detail: `missing or out of order: ${term}` };
      offset = found + term.length;
    }
    return { passed: true };
  }
  if (check.type === "countAtLeast") {
    const matches = text.match(toGlobalRegex(check)) || [];
    return {
      passed: matches.length >= check.min,
      detail: `${matches.length}/${check.min}`,
    };
  }
  return { passed: false, detail: `unknown check type: ${check.type}` };
}

function evaluateArtifact(scenario, artifactPath) {
  const text = fs.readFileSync(artifactPath, "utf8");
  const checks = {};
  for (const check of scenario.checks) {
    checks[check.id] = evaluateCheck(check, text);
  }
  return { artifact: path.relative(ROOT, artifactPath), checks };
}

function tally(results) {
  let pass = 0;
  let fail = 0;
  for (const result of results) {
    for (const check of Object.values(result.checks)) {
      if (check.passed) pass += 1;
      else fail += 1;
    }
  }
  return { pass, fail };
}

function printPrompts() {
  console.log("Forward-test prompts:\n");
  for (const scenario of selectedScenarios()) {
    console.log(`## ${scenario.id} — ${scenario.name}`);
    console.log(scenario.prompt);
    console.log(`\nSave final answer to: artifacts/${scenario.id}/r1.md\n`);
  }
}

function run(rootDir) {
  const summary = [];
  let missing = 0;
  for (const scenario of selectedScenarios()) {
    const artifacts = artifactPaths(scenario.id, rootDir);
    if (!artifacts.length) {
      missing += 1;
      summary.push({ scenario, results: [], missing: true });
      continue;
    }
    summary.push({
      scenario,
      results: artifacts.map((artifactPath) => evaluateArtifact(scenario, artifactPath)),
      missing: false,
    });
  }
  return { summary, missing };
}

function validate() {
  const ids = new Set();
  const errors = [];
  for (const [index, scenario] of scenarios.entries()) {
    const prefix = `scenario[${index}]`;
    for (const key of ["id", "name", "status", "kind", "prompt", "checks", "added"]) {
      if (!(key in scenario)) errors.push(`${prefix}: missing ${key}`);
    }
    if (scenario.id && !/^[a-z0-9][a-z0-9-]*$/.test(scenario.id)) errors.push(`${scenario.id}: invalid id`);
    if (ids.has(scenario.id)) errors.push(`${scenario.id}: duplicate id`);
    ids.add(scenario.id);
    if (!["active", "retired"].includes(scenario.status)) errors.push(`${scenario.id}: invalid status`);
    if (scenario.added && !/^\d{4}-\d{2}-\d{2}$/.test(scenario.added)) errors.push(`${scenario.id}: invalid added date`);
    if (!Array.isArray(scenario.checks) || scenario.checks.length === 0) errors.push(`${scenario.id}: checks must be non-empty`);
    for (const check of scenario.checks || []) {
      if (!check.id) errors.push(`${scenario.id}: check missing id`);
      if (!["must", "mustNot", "ordered", "countAtLeast"].includes(check.type)) errors.push(`${scenario.id}/${check.id}: invalid type`);
      if ((check.type === "must" || check.type === "mustNot" || check.type === "countAtLeast") && !check.pattern && !check.text) {
        errors.push(`${scenario.id}/${check.id}: missing pattern or text`);
      }
      if (check.type === "ordered" && (!Array.isArray(check.terms) || check.terms.length < 2)) {
        errors.push(`${scenario.id}/${check.id}: ordered checks need at least two terms`);
      }
      if (check.type === "countAtLeast" && typeof check.min !== "number") {
        errors.push(`${scenario.id}/${check.id}: countAtLeast needs min`);
      }
      try {
        if (check.pattern) toRegex(check);
      } catch (error) {
        errors.push(`${scenario.id}/${check.id}: invalid regex: ${error.message}`);
      }
    }
  }
  if (errors.length) {
    console.error("Validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    return false;
  }
  console.log(`Validated ${scenarios.length} scenario(s).`);
  return true;
}

function runWorkflowState(args, options = {}) {
  return execFileSync(process.execPath, [workflowState, ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_WORKFLOW_NOW: "2026-05-30T00:00:00.000Z",
    },
    ...options,
  }).trim();
}

function runtimeAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function readRuntimeJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function labelsByPhase(workflow) {
  return Object.fromEntries(workflow.phases.map((phase) => [phase.title, phase.agents.map((agent) => agent.label)]));
}

function runRuntimeEvals() {
  const failures = [];
  const checks = [];
  const check = (id, run) => {
    try {
      run();
      checks.push({ id, passed: true });
    } catch (error) {
      checks.push({ id, passed: false, detail: error.message });
      failures.push(`${id}: ${error.message}`);
    }
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dynamic-workflows-runtime-"));

  check("translate-js-mapped-agents", () => {
    const script = path.join(tmp, "tiny.js");
    fs.writeFileSync(script, `export const meta = {
  name: 'tiny-audit',
  description: 'Audit two modules',
  phases: [{ title: 'Discover' }, { title: 'Verify' }],
}
phase('Discover')
const findings = await parallel(['src/auth.ts','src/billing.ts'].map(file => () => agent('Inspect '+file, { label: file, schema: { type: 'object' }})))
phase('Verify')
const review = await agent('Try to refute findings', { label: 'adversary' })
return { findings, review }
`);
    const runDir = path.join(tmp, "translated");
    const workflowPath = runWorkflowState(["translate-js", script, "--out", runDir, "--run-id", "tiny-run"]);
    const workflow = readRuntimeJson(workflowPath);
    const labels = labelsByPhase(workflow);
    runtimeAssert(labels.Discover.includes("src/auth.ts"), "missing src/auth.ts mapped agent");
    runtimeAssert(labels.Discover.includes("src/billing.ts"), "missing src/billing.ts mapped agent");
    runtimeAssert(labels.Verify.includes("adversary"), "missing adversary verifier");
    runtimeAssert(!labels.Discover.includes("Discover"), "phase title was incorrectly parsed as an agent");
    runtimeAssert(fs.existsSync(path.join(runDir, "journal.jsonl")), "journal.jsonl was not created");
    runtimeAssert(fs.existsSync(path.join(runDir, "status.md")), "status.md was not created");
  });

  check("resume-reuses-completed-and-runs-only-missing", () => {
    const runDir = path.join(tmp, "translated");
    const workflowPath = path.join(runDir, "workflow.json");
    fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "outputs", "auth.md"), "auth result\n");
    runWorkflowState(["start-agent", workflowPath, "--label", "src/auth.ts", "--agent-id", "agent-auth"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "src/auth.ts", "--output", "outputs/auth.md", "--summary", "no issues"]);
    const plan = JSON.parse(runWorkflowState(["resume", workflowPath]));
    runtimeAssert(plan.reuseOutputs.some((item) => item.label === "src/auth.ts"), "completed auth output was not reusable");
    runtimeAssert(plan.readyAgents.length === 1 && plan.readyAgents[0].label === "src/billing.ts", "resume did not select only missing billing scan");
    runtimeAssert(!plan.readyAgents.some((item) => item.label === "adversary"), "verifier ran before discover phase completed");
  });

  check("resume-advances-to-next-phase-after-phase-complete", () => {
    const runDir = path.join(tmp, "translated");
    const workflowPath = path.join(runDir, "workflow.json");
    fs.writeFileSync(path.join(runDir, "outputs", "billing.md"), "billing result\n");
    runWorkflowState(["start-agent", workflowPath, "--label", "src/billing.ts", "--agent-id", "agent-billing"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "src/billing.ts", "--output", "outputs/billing.md", "--summary", "no issues"]);
    const plan = JSON.parse(runWorkflowState(["resume", workflowPath]));
    runtimeAssert(plan.readyAgents.length === 1 && plan.readyAgents[0].label === "adversary", "resume did not advance to verifier after scans completed");
  });

  check("cache-invalidates-on-prompt-change", () => {
    const workflowPath = path.join(tmp, "translated", "workflow.json");
    const workflow = readRuntimeJson(workflowPath);
    const auth = workflow.phases.flatMap((phase) => phase.agents).find((agent) => agent.label === "src/auth.ts");
    auth.promptPreview = "Changed prompt after completion";
    fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
    const plan = JSON.parse(runWorkflowState(["resume", workflowPath]));
    runtimeAssert(plan.staleAgents.some((item) => item.label === "src/auth.ts"), "changed prompt did not mark completed auth scan stale");
    runtimeAssert(!plan.reuseOutputs.some((item) => item.label === "src/auth.ts"), "stale auth output was still treated as reusable");
  });

  check("dependency-gates-failed-scan", () => {
    const spec = path.join(tmp, "dependency-spec.json");
    fs.writeFileSync(spec, JSON.stringify({
      name: "dependency-gate",
      goal: "Verify only after all scans complete",
      concurrency: 3,
      phases: [
        {
          title: "Scan",
          agents: [
            { label: "scan-a" },
            { label: "scan-b" },
            { label: "scan-c" },
          ],
        },
        {
          title: "Verify",
          agents: [
            { label: "verifier", dependsOn: ["scan-a", "scan-b", "scan-c"] },
          ],
        },
      ],
    }, null, 2));
    const runDir = path.join(tmp, "dependency");
    const workflowPath = runWorkflowState(["create", "--spec", spec, "--out", runDir, "--run-id", "dependency-run"]);
    fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "outputs", "a.md"), "a\n");
    fs.writeFileSync(path.join(runDir, "outputs", "b.md"), "b\n");
    runWorkflowState(["start-agent", workflowPath, "--label", "scan-a"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "scan-a", "--output", "outputs/a.md"]);
    runWorkflowState(["start-agent", workflowPath, "--label", "scan-b"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "scan-b", "--output", "outputs/b.md"]);
    runWorkflowState(["fail-agent", workflowPath, "--label", "scan-c", "--error", "scan failed"]);
    const plan = JSON.parse(runWorkflowState(["resume", workflowPath]));
    runtimeAssert(plan.failedAgents.some((item) => item.label === "scan-c"), "failed scan was not reported");
    runtimeAssert(!plan.readyAgents.some((item) => item.label === "verifier"), "verifier was runnable despite failed dependency");
  });

  check("resume-refuses-missing-completed-output", () => {
    const spec = path.join(tmp, "missing-output-spec.json");
    fs.writeFileSync(spec, JSON.stringify({
      name: "missing-output",
      goal: "Do not reuse missing outputs",
      phases: [
        { title: "Scan", agents: [{ label: "scan" }] },
      ],
    }, null, 2));
    const runDir = path.join(tmp, "missing-output");
    const workflowPath = runWorkflowState(["create", "--spec", spec, "--out", runDir, "--run-id", "missing-output-run"]);
    fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
    const output = path.join(runDir, "outputs", "scan.md");
    fs.writeFileSync(output, "scan result\n");
    runWorkflowState(["start-agent", workflowPath, "--label", "scan"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "scan", "--output", "outputs/scan.md"]);
    fs.unlinkSync(output);
    const plan = JSON.parse(runWorkflowState(["resume", workflowPath]));
    runtimeAssert(plan.staleAgents.some((item) => item.label === "scan" && /missing output file/.test(item.reason)), "missing output was not marked stale");
    runtimeAssert(!plan.reuseOutputs.some((item) => item.label === "scan"), "missing output was still reusable");
    runtimeAssert(plan.readyAgents.some((item) => item.label === "scan"), "missing output scan was not scheduled to rerun");
  });

  check("downstream-invalidates-after-upstream-output-change", () => {
    const spec = path.join(tmp, "downstream-spec.json");
    fs.writeFileSync(spec, JSON.stringify({
      name: "downstream-cache",
      goal: "Verifier consumes prior scan output",
      phases: [
        { title: "Scan", agents: [{ label: "scan" }] },
        { title: "Verify", agents: [{ label: "verifier" }] },
      ],
    }, null, 2));
    const runDir = path.join(tmp, "downstream-cache");
    const workflowPath = runWorkflowState(["create", "--spec", spec, "--out", runDir, "--run-id", "downstream-cache-run"]);
    fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "outputs", "scan.md"), "scan v1\n");
    fs.writeFileSync(path.join(runDir, "outputs", "verify.md"), "verify v1\n");
    runWorkflowState(["start-agent", workflowPath, "--label", "scan", "--agent-id", "scan-1"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "scan", "--output", "outputs/scan.md"]);
    runWorkflowState(["start-agent", workflowPath, "--label", "verifier", "--agent-id", "verify-1"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "verifier", "--output", "outputs/verify.md"]);
    fs.writeFileSync(path.join(runDir, "outputs", "scan.md"), "scan v2\n");
    runWorkflowState(["start-agent", workflowPath, "--label", "scan", "--agent-id", "scan-2"]);
    runWorkflowState(["finish-agent", workflowPath, "--label", "scan", "--output", "outputs/scan.md"]);
    const plan = JSON.parse(runWorkflowState(["resume", workflowPath]));
    runtimeAssert(plan.reuseOutputs.some((item) => item.label === "scan"), "rerun scan output was not reusable");
    runtimeAssert(plan.staleAgents.some((item) => item.label === "verifier"), "downstream verifier was not marked stale");
    runtimeAssert(!plan.reuseOutputs.some((item) => item.label === "verifier"), "stale verifier output was still reusable");
    runtimeAssert(plan.readyAgents.some((item) => item.label === "verifier"), "stale verifier was not scheduled to rerun");
  });

  check("saved-template-excludes-run-cache", () => {
    const workflowPath = path.join(tmp, "translated", "workflow.json");
    const template = path.join(tmp, "tiny-template.json");
    runWorkflowState(["save-template", workflowPath, "--out", template]);
    const text = fs.readFileSync(template, "utf8");
    runtimeAssert(!text.includes("outputHash"), "template leaked output hash");
    runtimeAssert(!text.includes("cacheKey"), "template leaked cache key");
    runtimeAssert(!text.includes("outputs/auth.md"), "template leaked run output path");
  });

  console.log("\n=== dynamic-workflows runtime evals ===");
  for (const result of checks) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}${result.detail ? ` - ${result.detail}` : ""}`);
  }
  console.log(`\nTotal: ${checks.filter((item) => item.passed).length} pass, ${failures.length} fail\n`);

  const outDir = path.join(ROOT, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(outDir, `${stamp}-runtime.json`),
    JSON.stringify({ when: stamp, mode: "runtime", checks }, null, 2),
  );

  return failures.length === 0;
}

function printSummary(runResult, label) {
  console.log(`\n=== dynamic-workflows eval results${label ? ` (${label})` : ""} ===`);
  let totalPass = 0;
  let totalFail = 0;
  for (const item of runResult.summary) {
    if (item.missing) {
      console.log(`\n${item.scenario.id} — ${item.scenario.name}`);
      console.log("  ! missing artifact");
      continue;
    }
    const counts = tally(item.results);
    totalPass += counts.pass;
    totalFail += counts.fail;
    console.log(`\n${item.scenario.id} — ${item.scenario.name}`);
    console.log(`  checks: ${counts.pass} pass, ${counts.fail} fail across ${item.results.length} artifact(s)`);
    for (const result of item.results) {
      const failed = Object.entries(result.checks).filter(([, check]) => !check.passed);
      if (failed.length) {
        console.log(`  ${result.artifact}`);
        for (const [id, check] of failed) {
          console.log(`    ✗ ${id}${check.detail ? ` (${check.detail})` : ""}`);
        }
      }
    }
  }
  console.log(`\nTotal: ${totalPass} pass, ${totalFail} fail, ${runResult.missing} missing scenario(s)\n`);
  return totalFail === 0 && runResult.missing === 0;
}

if (flag("--validate")) {
  process.exit(validate() ? 0 : 1);
}

if (flag("--runtime")) {
  process.exit(runRuntimeEvals() ? 0 : 1);
}

if (flag("--prompts")) {
  printPrompts();
  process.exit(0);
}

const rootDir = flag("--fixtures")
  ? path.join(ROOT, "fixtures", "pass")
  : path.join(ROOT, "artifacts");

const result = run(rootDir);
const ok = printSummary(result, flag("--fixtures") ? "fixtures" : "");
const outDir = path.join(ROOT, "results");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(
  path.join(outDir, `${stamp}.json`),
  JSON.stringify({ when: stamp, mode: flag("--fixtures") ? "fixtures" : "artifacts", result }, null, 2),
);
process.exit(ok ? 0 : 1);
