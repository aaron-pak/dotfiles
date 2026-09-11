#!/usr/bin/env node
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CACHE_VERSION = 2;
const SCHEMA_VERSION = 2;
const AGENT_STATUSES = new Set(["pending", "running", "completed", "failed", "skipped", "stale", "blocked", "paused"]);
const STATUS_ALIASES = new Map([["done", "completed"]]);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function usage() {
  console.log(`Usage:
  workflow-state.mjs init --name <name> --goal <goal> [--phase <title>]... [--concurrency <n>] [--out <dir>] [--run-id <id>]
  workflow-state.mjs create --spec <workflow.spec.json> [--out <dir>] [--run-id <id>]
  workflow-state.mjs translate-js <script.js> [--args <value>] [--out <dir>] [--run-id <id>]
  workflow-state.mjs add-agent <workflow.json> --phase <title> --label <label> [--type <type>] [--scope <scope>] [--prompt <text>] [--depends-on <label,label>]
  workflow-state.mjs start-agent <workflow.json> --label <label> [--agent-id <id>]
  workflow-state.mjs finish-agent <workflow.json> --label <label> --output <path> [--summary <text>]
  workflow-state.mjs fail-agent <workflow.json> --label <label> [--error <text>]
  workflow-state.mjs update-agent <workflow.json> --label <label> --status <status> [--agent-id <id>] [--output <path>] [--summary <text>] [--error <text>]
  workflow-state.mjs log <workflow.json> --message <text>
  workflow-state.mjs status <workflow.json>
  workflow-state.mjs resume <workflow.json>
  workflow-state.mjs next <workflow.json>
  workflow-state.mjs validate <workflow.json>
  workflow-state.mjs render <workflow.json>
  workflow-state.mjs save-template <workflow.json> --out <file>
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    if (out[key] === undefined) out[key] = value;
    else if (Array.isArray(out[key])) out[key].push(value);
    else out[key] = [out[key], value];
  }
  return out;
}

function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function nowIso() {
  return process.env.CODEX_WORKFLOW_NOW || new Date().toISOString();
}

function slugify(text) {
  return String(text || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "workflow";
}

function stamp() {
  return nowIso().replace(/[:.]/g, "-").replace(/z$/i, "Z");
}

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function defaultRunId(name) {
  return `${stamp()}-${slugify(name)}`;
}

function defaultRunDir(name, runId = defaultRunId(name)) {
  return path.join(process.cwd(), ".codex", "workflows", "runs", runId);
}

function normalizeStatus(status) {
  const normalized = STATUS_ALIASES.get(status) || status;
  if (!AGENT_STATUSES.has(normalized)) throw new Error(`invalid status: ${status}`);
  return normalized;
}

function splitList(value) {
  return asArray(value)
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function writeJson(file, data) {
  data.updatedAt = nowIso();
  atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
}

function runDirFor(fileOrWorkflow, workflow) {
  if (workflow?.paths?.runDir) return workflow.paths.runDir;
  return path.dirname(fileOrWorkflow);
}

function relativeOutputPath(outputPath) {
  if (!outputPath) return "";
  if (path.isAbsolute(outputPath)) throw new Error("output path must be relative to the workflow run directory");
  const normalized = path.normalize(outputPath);
  if (normalized.startsWith("..") || normalized === ".") throw new Error("output path must stay inside the workflow run directory");
  return normalized;
}

function outputFile(jsonFile, workflow, outputPath) {
  return path.join(runDirFor(jsonFile, workflow), relativeOutputPath(outputPath));
}

function outputExists(jsonFile, workflow, outputPath) {
  return fs.existsSync(outputFile(jsonFile, workflow, outputPath));
}

function outputHash(jsonFile, workflow, outputPath) {
  const file = outputFile(jsonFile, workflow, outputPath);
  if (!fs.existsSync(file)) return "";
  return hash(fs.readFileSync(file));
}

function makeAgent(options = {}) {
  return {
    label: options.label,
    type: options.type || "default",
    scope: options.scope || "",
    promptPreview: options.promptPreview || options.prompt || "",
    outputContract: options.outputContract || "",
    dependsOn: splitList(options.dependsOn || options["depends-on"]),
    status: normalizeStatus(options.status || "pending"),
    agentId: options.agentId || "",
    outputPath: options.outputPath || "",
    outputHash: options.outputHash || "",
    cacheKey: options.cacheKey || "",
    resultSummary: options.resultSummary || "",
    attempt: Number(options.attempt || 0),
    startedAt: options.startedAt || "",
    finishedAt: options.finishedAt || "",
    staleReason: options.staleReason || "",
    error: options.error || "",
  };
}

function createPhase(input, index) {
  const title = input.title || `Phase ${index + 1}`;
  return {
    id: input.id || slugify(title),
    title,
    detail: input.detail || "",
    status: "pending",
    approvalRequired: Boolean(input.approvalRequired),
    approved: Boolean(input.approved),
    agents: (input.agents || []).map((agent) => makeAgent(agent)),
  };
}

function createRun(spec, options = {}) {
  const name = spec.workflowName || spec.name;
  const goal = spec.goal || spec.description;
  if (!name || !goal) throw new Error("workflow spec requires name/workflowName and goal/description");
  const runId = options.runId || spec.runId || defaultRunId(name);
  const runDir = options.runDir || options.out || spec.out || defaultRunDir(name, runId);
  const createdAt = nowIso();
  const workflow = {
    schemaVersion: SCHEMA_VERSION,
    cacheVersion: CACHE_VERSION,
    runId,
    workflowName: name,
    goal,
    state: "running",
    concurrency: Number(spec.concurrency || options.concurrency || 4),
    createdAt,
    updatedAt: createdAt,
    source: spec.source || null,
    paths: {
      runDir,
      manifest: "workflow.md",
      status: "status.md",
      journal: "journal.jsonl",
      outputsDir: "outputs",
    },
    phases: (spec.phases || []).map(createPhase),
    verification: spec.verification || { status: "pending", checks: [] },
    logs: [],
  };
  validatePlanShape(workflow);
  return normalize(workflow, path.join(runDir, "workflow.json"));
}

function workflowFile(runDir) {
  return path.join(runDir, "workflow.json");
}

function journalFile(jsonFile, workflow) {
  return path.join(runDirFor(jsonFile, workflow), workflow.paths?.journal || "journal.jsonl");
}

function resetDynamicState(workflow) {
  const copy = structuredClone(workflow);
  copy.logs = [];
  for (const phase of copy.phases) {
    phase.status = "pending";
    for (const agent of phase.agents) {
      const staticAgent = makeAgent(agent);
      Object.assign(agent, staticAgent, {
        status: "pending",
        agentId: "",
        outputPath: "",
        outputHash: "",
        cacheKey: "",
        resultSummary: "",
        attempt: 0,
        startedAt: "",
        finishedAt: "",
        staleReason: "",
        error: "",
      });
    }
  }
  return copy;
}

function journalEvents(jsonFile, workflow) {
  const file = journalFile(jsonFile, workflow);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function applyEvent(workflow, event) {
  if (event.type === "log") {
    workflow.logs.push({ at: event.at, message: event.message });
    return;
  }
  const agent = findAgent(workflow, event.label);
  if (!agent) return;
  if (event.type === "agent.started") {
    agent.status = "running";
    agent.agentId = event.agentId || agent.agentId;
    agent.cacheKey = event.cacheKey || agent.cacheKey;
    agent.startedAt = event.at || agent.startedAt;
    agent.attempt = Number(agent.attempt || 0) + 1;
    return;
  }
  if (event.type === "agent.updated" || event.type === "agent.finished" || event.type === "agent.failed") {
    agent.status = normalizeStatus(event.status);
    agent.agentId = event.agentId || agent.agentId;
    agent.outputPath = event.outputPath || agent.outputPath;
    agent.outputHash = event.outputHash || agent.outputHash;
    agent.cacheKey = event.cacheKey || agent.cacheKey;
    agent.resultSummary = event.summary || agent.resultSummary;
    agent.error = event.error || agent.error;
    agent.staleReason = event.staleReason || agent.staleReason;
    if (agent.status === "completed" || agent.status === "failed" || agent.status === "skipped") agent.finishedAt = event.at || agent.finishedAt;
  }
}

function deriveFromJournal(jsonFile, workflow) {
  const events = journalEvents(jsonFile, workflow);
  if (!events.length) return workflow;
  const derived = resetDynamicState(workflow);
  for (const event of events) applyEvent(derived, event);
  return normalize(derived, jsonFile);
}

function loadRun(jsonFile, options = {}) {
  const workflow = readJson(jsonFile);
  return options.raw ? workflow : deriveFromJournal(jsonFile, workflow);
}

function appendJournal(jsonFile, workflow, event) {
  const file = journalFile(jsonFile, workflow);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sequence = journalEvents(jsonFile, workflow).length + 1;
  fs.appendFileSync(file, `${JSON.stringify({ sequence, at: nowIso(), ...event })}\n`);
}

function findPhase(workflow, title) {
  let phase = workflow.phases.find((candidate) => candidate.title === title || candidate.id === title);
  if (!phase) {
    phase = createPhase({ title }, workflow.phases.length);
    workflow.phases.push(phase);
  }
  return phase;
}

function findAgent(workflow, label) {
  for (const phase of workflow.phases) {
    const agent = phase.agents.find((candidate) => candidate.label === label);
    if (agent) return agent;
  }
  return null;
}

function findAgentWithPhase(workflow, label) {
  for (const phase of workflow.phases) {
    const agent = phase.agents.find((candidate) => candidate.label === label);
    if (agent) return { phase, agent };
  }
  return null;
}

function validatePlanShape(workflow) {
  const phaseIds = new Set();
  const labels = new Set();
  for (const phase of workflow.phases) {
    if (phaseIds.has(phase.id)) throw new Error(`duplicate phase id: ${phase.id}`);
    phaseIds.add(phase.id);
    for (const agent of phase.agents) {
      if (!agent.label) throw new Error(`agent in phase ${phase.title} is missing label`);
      if (labels.has(agent.label)) throw new Error(`duplicate agent label: ${agent.label}`);
      labels.add(agent.label);
    }
  }
  for (const phase of workflow.phases) {
    for (const agent of phase.agents) {
      for (const dependency of agent.dependsOn || []) {
        if (!labels.has(dependency)) throw new Error(`${agent.label} depends on unknown agent: ${dependency}`);
      }
    }
  }
}

function effectiveDependencyLabels(workflow, agent) {
  if (agent.dependsOn?.length) return agent.dependsOn;
  const found = findAgentWithPhase(workflow, agent.label);
  if (!found) return [];
  const phaseIndex = workflow.phases.indexOf(found.phase);
  if (phaseIndex <= 0) return [];
  return workflow.phases
    .slice(0, phaseIndex)
    .flatMap((phase) => phase.agents.map((candidate) => candidate.label));
}

function computeCacheKey(workflow, agent) {
  const dependencyHashes = effectiveDependencyLabels(workflow, agent).map((label) => {
    const dependency = findAgent(workflow, label);
    return { label, status: dependency?.status || "missing", outputHash: dependency?.outputHash || "" };
  });
  return `v${CACHE_VERSION}:${hash(stableJson({
    schemaVersion: SCHEMA_VERSION,
    label: agent.label,
    promptPreview: agent.promptPreview,
    scope: agent.scope,
    outputContract: agent.outputContract,
    dependsOn: dependencyHashes,
  }))}`;
}

function markStaleAgents(workflow, jsonFile) {
  for (const phase of workflow.phases) {
    for (const agent of phase.agents) {
      if (agent.status !== "completed") continue;
      if (!agent.outputPath) {
        agent.status = "stale";
        agent.staleReason = "missing output path";
        continue;
      }
      const nextKey = computeCacheKey(workflow, agent);
      if (agent.cacheKey && agent.cacheKey !== nextKey) {
        agent.status = "stale";
        agent.staleReason = "cache key changed";
      }
      if (agent.outputPath) {
        if (!outputExists(jsonFile, workflow, agent.outputPath)) {
          agent.status = "stale";
          agent.staleReason = "missing output file";
          continue;
        }
        const currentHash = outputHash(jsonFile, workflow, agent.outputPath);
        if (!agent.outputHash) {
          agent.status = "stale";
          agent.staleReason = "missing output hash";
        } else if (currentHash !== agent.outputHash) {
          agent.status = "stale";
          agent.staleReason = "output hash changed";
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of workflow.phases) {
      for (const agent of phase.agents) {
        if (agent.status !== "completed") continue;
        const dependency = effectiveDependencyLabels(workflow, agent)
          .map((label) => ({ label, agent: findAgent(workflow, label) }))
          .find((item) => item.agent?.status !== "completed");
        if (dependency) {
          agent.status = "stale";
          agent.staleReason = `dependency ${dependency.label} is ${dependency.agent?.status || "missing"}`;
          changed = true;
        }
      }
    }
  }
}

function phaseStatus(phase) {
  if (!phase.agents.length) return phase.status || "pending";
  if (phase.approvalRequired && !phase.approved) return "blocked";
  if (phase.agents.some((agent) => agent.status === "running")) return "running";
  if (phase.agents.some((agent) => agent.status === "failed")) return "failed";
  if (phase.agents.some((agent) => agent.status === "stale")) return "stale";
  if (phase.agents.every((agent) => ["completed", "skipped"].includes(agent.status))) return "completed";
  return "pending";
}

function workflowStatus(workflow) {
  const statuses = workflow.phases.map(phaseStatus);
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "running")) return "running";
  if (statuses.some((status) => status === "blocked")) return "blocked";
  if (statuses.some((status) => status === "stale")) return "running";
  if (statuses.length && statuses.every((status) => status === "completed")) return "completed";
  return workflow.state === "paused" ? "paused" : "running";
}

function normalize(workflow, jsonFile = "") {
  validatePlanShape(workflow);
  if (jsonFile) markStaleAgents(workflow, jsonFile);
  for (const phase of workflow.phases) phase.status = phaseStatus(phase);
  workflow.state = workflowStatus(workflow);
  return workflow;
}

function renderProgress(workflow) {
  const lines = [
    "| Phase | Agent | Status | Agent ID | Output | Notes |",
    "|---|---|---:|---|---|---|",
  ];
  for (const phase of workflow.phases) {
    if (!phase.agents.length) lines.push(`| ${phase.title} |  | ${phase.status} |  |  | ${phase.detail || ""} |`);
    for (const agent of phase.agents) {
      const notes = agent.staleReason || agent.error || agent.resultSummary || "";
      lines.push(`| ${phase.title} | ${agent.label} | ${agent.status} | ${agent.agentId || ""} | ${agent.outputPath || ""} | ${notes} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderResumeMarkdown(workflow) {
  const plan = getResumePlan(workflow);
  const lines = [];
  lines.push("Reuse completed outputs:");
  if (plan.reuseOutputs.length) {
    for (const item of plan.reuseOutputs) lines.push(`- ${item.label}: ${item.outputPath}`);
  } else {
    lines.push("- none");
  }
  lines.push("", "Run next:");
  if (plan.readyAgents.length) {
    for (const item of plan.readyAgents) lines.push(`- ${item.label}`);
  } else {
    lines.push("- none");
  }
  lines.push("", "Blocked:");
  if (plan.blockedAgents.length) {
    for (const item of plan.blockedAgents) lines.push(`- ${item.label}: ${item.reason}`);
  } else {
    lines.push("- none");
  }
  if (plan.failedAgents.length) {
    lines.push("", "Failed:");
    for (const item of plan.failedAgents) lines.push(`- ${item.label}: ${item.error || "failed"}`);
  }
  if (plan.staleAgents.length) {
    lines.push("", "Stale:");
    for (const item of plan.staleAgents) lines.push(`- ${item.label}: ${item.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(workflow) {
  normalize(workflow);
  const lines = [
    `# Workflow: ${workflow.workflowName}`,
    "",
    `Goal: ${workflow.goal}`,
    `Run ID: ${workflow.runId}`,
    `State: ${workflow.state}`,
    `Concurrency: ${workflow.concurrency}`,
    `Created: ${workflow.createdAt}`,
    `Updated: ${workflow.updatedAt}`,
    "",
    "## Phases",
  ];

  workflow.phases.forEach((phase, index) => {
    lines.push("", `${index + 1}. ${phase.title} (${phase.status})`);
    if (phase.detail) lines.push(`   - Detail: ${phase.detail}`);
    if (phase.approvalRequired) lines.push(`   - Approval: ${phase.approved ? "approved" : "required"}`);
    if (!phase.agents.length) lines.push("   - Agents: none yet");
    for (const agent of phase.agents) {
      lines.push(`   - [${agent.status}] ${agent.label}`);
      if (agent.type) lines.push(`     - Type: ${agent.type}`);
      if (agent.scope) lines.push(`     - Scope: ${agent.scope}`);
      if (agent.dependsOn?.length) lines.push(`     - Depends on: ${agent.dependsOn.join(", ")}`);
      if (agent.agentId) lines.push(`     - Agent ID: ${agent.agentId}`);
      if (agent.outputPath) lines.push(`     - Output: ${agent.outputPath}`);
      if (agent.outputHash) lines.push(`     - Output hash: ${agent.outputHash}`);
      if (agent.cacheKey) lines.push(`     - Cache key: ${agent.cacheKey}`);
      if (agent.resultSummary) lines.push(`     - Summary: ${agent.resultSummary}`);
      if (agent.staleReason) lines.push(`     - Stale reason: ${agent.staleReason}`);
      if (agent.error) lines.push(`     - Error: ${agent.error}`);
    }
  });

  lines.push("", "## Progress", renderProgress(workflow).trimEnd(), "", "## Resume Plan", renderResumeMarkdown(workflow).trimEnd());

  if (workflow.logs.length) {
    lines.push("", "## Logs");
    for (const log of workflow.logs) lines.push(`- ${log.at}: ${log.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function saveRun(jsonFile, workflow) {
  const normalized = normalize(workflow, jsonFile);
  const runDir = runDirFor(jsonFile, normalized);
  fs.mkdirSync(path.join(runDir, normalized.paths.outputsDir), { recursive: true });
  const journal = journalFile(jsonFile, normalized);
  if (!fs.existsSync(journal)) atomicWrite(journal, "");
  writeJson(jsonFile, normalized);
  atomicWrite(path.join(runDir, normalized.paths.manifest), renderMarkdown(normalized));
  atomicWrite(path.join(runDir, normalized.paths.status), renderProgress(normalized));
  return normalized;
}

function getResumePlan(workflow) {
  normalize(workflow);
  const completed = [];
  const stale = [];
  const failed = [];
  const ready = [];
  const blocked = [];
  const runningCount = workflow.phases.flatMap((phase) => phase.agents).filter((agent) => agent.status === "running").length;
  const capacity = Math.max(0, workflow.concurrency - runningCount);

  for (const phase of workflow.phases) {
    for (const agent of phase.agents) {
      if (agent.status === "completed") completed.push({ label: agent.label, outputPath: agent.outputPath, outputHash: agent.outputHash });
      if (agent.status === "stale") stale.push({ label: agent.label, reason: agent.staleReason || "stale" });
      if (agent.status === "failed") failed.push({ label: agent.label, error: agent.error });
    }
  }

  for (const phase of workflow.phases) {
    if (phase.approvalRequired && !phase.approved) {
      for (const agent of phase.agents.filter((candidate) => candidate.status === "pending")) {
        blocked.push({ label: agent.label, reason: "phase approval required" });
      }
      return planObject(workflow, completed, stale, failed, ready.slice(0, capacity), blocked, true);
    }

    if (["completed", "skipped"].includes(phase.status)) continue;

    for (const agent of phase.agents) {
      if (!["pending", "stale"].includes(agent.status)) continue;
      const dependencyStates = effectiveDependencyLabels(workflow, agent).map((label) => ({ label, agent: findAgent(workflow, label) }));
      const failedDependency = dependencyStates.find((item) => item.agent?.status === "failed");
      if (failedDependency) {
        blocked.push({ label: agent.label, reason: `waiting for failed dependency ${failedDependency.label}` });
        continue;
      }
      const missing = dependencyStates.filter((item) => item.agent?.status !== "completed").map((item) => item.label);
      if (missing.length) {
        blocked.push({ label: agent.label, reason: `waiting for ${missing.join(", ")}` });
        continue;
      }
      ready.push({
        label: agent.label,
        type: agent.type,
        scope: agent.scope,
        promptPreview: agent.promptPreview,
        outputContract: agent.outputContract,
      });
    }
    break;
  }

  return planObject(workflow, completed, stale, failed, ready.slice(0, capacity), blocked, false);
}

function planObject(workflow, completed, stale, failed, ready, blocked, approvalRequired) {
  return {
    state: workflow.state,
    readyAgents: ready,
    blockedAgents: blocked,
    reuseOutputs: completed,
    staleAgents: stale,
    failedAgents: failed,
    approvalRequired,
  };
}

function extractQuotedAfter(key, text) {
  const match = text.match(new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`));
  return match ? match[1] : "";
}

function addParsedAgent(phases, phaseByTitle, phaseMarkers, seenLabels, label, index, details = {}) {
  if (seenLabels.has(label)) return;
  const explicitPhase = details.explicitPhase;
  const marker = [...phaseMarkers].reverse().find((candidate) => candidate.index < index);
  const title = explicitPhase || marker?.title || phases[0].title;
  const phase = phaseByTitle.get(title) || phases[0];
  phase.agents.push(makeAgent({
    label,
    type: "default",
    scope: details.scope || "",
    promptPreview: details.promptPreview || "Translated from Claude workflow agent(...) call",
    outputContract: details.outputContract || "",
    dependsOn: details.dependsOn || [],
  }));
  seenLabels.add(label);
}

function parseClaudeWorkflow(script) {
  const name = extractQuotedAfter("name", script) || "translated-workflow";
  const description = extractQuotedAfter("description", script) || `Translated Claude workflow ${name}`;
  const phases = [];
  const phaseByTitle = new Map();

  for (const match of script.matchAll(/title\s*:\s*['"`]([^'"`]+)['"`](?:\s*,\s*detail\s*:\s*['"`]([^'"`]+)['"`])?/g)) {
    const phase = createPhase({ title: match[1], detail: match[2] || "" }, phases.length);
    phases.push(phase);
    phaseByTitle.set(phase.title, phase);
  }

  const phaseMarkers = [...script.matchAll(/phase\(\s*['"`]([^'"`]+)['"`]\s*\)/g)]
    .map((match) => ({ index: match.index, title: match[1] }));
  if (!phases.length && phaseMarkers.length) {
    for (const marker of phaseMarkers) {
      const phase = createPhase({ title: marker.title }, phases.length);
      phases.push(phase);
      phaseByTitle.set(phase.title, phase);
    }
  }
  if (!phases.length) {
    const phase = createPhase({ title: "Run" }, 0);
    phases.push(phase);
    phaseByTitle.set(phase.title, phase);
  }

  const seenLabels = new Set();
  const mappedAgentRegex = /\[([^\]]*)\]\.map\(\s*([A-Za-z_$][\w$]*)\s*=>[\s\S]{0,1600}?agent\([\s\S]{0,1600}?label\s*:\s*\2/g;
  for (const match of script.matchAll(mappedAgentRegex)) {
    const labels = [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((labelMatch) => labelMatch[1]);
    for (const label of labels) {
      addParsedAgent(phases, phaseByTitle, phaseMarkers, seenLabels, label, match.index, {
        promptPreview: "Translated from Claude workflow mapped agent(...) call",
        outputContract: script.slice(match.index, match.index + 1600).includes("schema") ? "schema referenced in Claude workflow" : "",
      });
    }
  }

  for (const match of script.matchAll(/label\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    const label = match[1];
    const window = script.slice(Math.max(0, match.index - 300), match.index + 300);
    const explicitPhase = window.match(/phase\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    addParsedAgent(phases, phaseByTitle, phaseMarkers, seenLabels, label, match.index, {
      explicitPhase,
      outputContract: window.includes("schema") ? "schema referenced in Claude workflow" : "",
    });
  }

  return {
    name,
    description,
    phases,
    usesParallel: /\bparallel\s*\(/.test(script),
    usesPipeline: /\bpipeline\s*\(/.test(script),
    usesLog: /\blog\s*\(/.test(script),
  };
}

function commandInit(options) {
  const phases = asArray(options.phase).map((title, index) => createPhase({ title }, index));
  const workflow = createRun({
    name: options.name,
    goal: options.goal,
    concurrency: options.concurrency,
    phases,
  }, { out: options.out, runId: options["run-id"] });
  const file = workflowFile(workflow.paths.runDir);
  saveRun(file, workflow);
  console.log(file);
}

function commandCreate(options) {
  if (!options.spec) throw new Error("create requires --spec");
  const spec = readJson(options.spec);
  const workflow = createRun(spec, { out: options.out, runId: options["run-id"] });
  const file = workflowFile(workflow.paths.runDir);
  saveRun(file, workflow);
  console.log(file);
}

function commandTranslateJs(scriptPath, options) {
  if (!scriptPath) throw new Error("translate-js requires a script path");
  const script = fs.readFileSync(scriptPath, "utf8");
  const parsed = parseClaudeWorkflow(script);
  const workflow = createRun({
    name: parsed.name,
    goal: parsed.description,
    concurrency: options.concurrency || 4,
    phases: parsed.phases,
    source: {
      kind: "claude-js",
      scriptPath: path.resolve(scriptPath),
      args: options.args || "",
      usesParallel: parsed.usesParallel,
      usesPipeline: parsed.usesPipeline,
      usesLog: parsed.usesLog,
    },
  }, { out: options.out, runId: options["run-id"] });
  const file = workflowFile(workflow.paths.runDir);
  saveRun(file, workflow);
  console.log(file);
}

function updateAndSave(file, update) {
  const workflow = loadRun(file);
  update(workflow);
  saveRun(file, workflow);
}

function commandAddAgent(file, options) {
  if (!options.phase || !options.label) throw new Error("add-agent requires --phase and --label");
  updateAndSave(file, (workflow) => {
    const phase = findPhase(workflow, options.phase);
    if (findAgent(workflow, options.label)) throw new Error(`agent already exists: ${options.label}`);
    phase.agents.push(makeAgent({
      label: options.label,
      type: options.type,
      scope: options.scope,
      promptPreview: options.prompt,
      outputContract: options["output-contract"],
      dependsOn: options["depends-on"],
    }));
  });
  console.log(file);
}

function commandStartAgent(file, options) {
  if (!options.label) throw new Error("start-agent requires --label");
  const workflow = loadRun(file);
  const agent = findAgent(workflow, options.label);
  if (!agent) throw new Error(`agent not found: ${options.label}`);
  appendJournal(file, workflow, {
    type: "agent.started",
    label: agent.label,
    agentId: options["agent-id"] || agent.agentId || "",
    cacheKey: computeCacheKey(workflow, agent),
  });
  saveRun(file, loadRun(file));
  console.log(file);
}

function commandFinishAgent(file, options) {
  if (!options.label || !options.output) throw new Error("finish-agent requires --label and --output");
  const workflow = loadRun(file);
  const agent = findAgent(workflow, options.label);
  if (!agent) throw new Error(`agent not found: ${options.label}`);
  const outputPath = relativeOutputPath(options.output);
  const hashValue = outputHash(file, workflow, outputPath);
  if (!hashValue) throw new Error(`output file does not exist: ${outputPath}`);
  appendJournal(file, workflow, {
    type: "agent.finished",
    label: agent.label,
    status: "completed",
    agentId: options["agent-id"] || agent.agentId || "",
    outputPath,
    outputHash: hashValue,
    cacheKey: computeCacheKey(workflow, agent),
    summary: options.summary || "",
  });
  saveRun(file, loadRun(file));
  console.log(file);
}

function commandFailAgent(file, options) {
  if (!options.label) throw new Error("fail-agent requires --label");
  const workflow = loadRun(file);
  const agent = findAgent(workflow, options.label);
  if (!agent) throw new Error(`agent not found: ${options.label}`);
  appendJournal(file, workflow, {
    type: "agent.failed",
    label: agent.label,
    status: "failed",
    agentId: options["agent-id"] || agent.agentId || "",
    error: options.error || "failed",
  });
  saveRun(file, loadRun(file));
  console.log(file);
}

function commandUpdateAgent(file, options) {
  if (!options.label || !options.status) throw new Error("update-agent requires --label and --status");
  const status = normalizeStatus(options.status);
  const workflow = loadRun(file);
  const agent = findAgent(workflow, options.label);
  if (!agent) throw new Error(`agent not found: ${options.label}`);
  let outputPath = options.output ? relativeOutputPath(options.output) : agent.outputPath;
  let hashValue = outputPath ? outputHash(file, workflow, outputPath) : "";
  if (status === "completed" && !outputPath) throw new Error("completed agents require --output");
  appendJournal(file, workflow, {
    type: "agent.updated",
    label: agent.label,
    status,
    agentId: options["agent-id"] || agent.agentId || "",
    outputPath,
    outputHash: hashValue,
    cacheKey: computeCacheKey(workflow, agent),
    summary: options.summary || "",
    error: options.error || "",
    staleReason: options["stale-reason"] || "",
  });
  saveRun(file, loadRun(file));
  console.log(file);
}

function commandLog(file, options) {
  if (!options.message) throw new Error("log requires --message");
  const workflow = loadRun(file);
  appendJournal(file, workflow, { type: "log", message: options.message });
  saveRun(file, loadRun(file));
  console.log(file);
}

function commandStatus(file) {
  const workflow = loadRun(file);
  console.log(renderMarkdown(workflow));
}

function commandResume(file) {
  const workflow = loadRun(file);
  console.log(JSON.stringify(getResumePlan(workflow), null, 2));
}

function validateRun(workflow, jsonFile) {
  normalize(workflow, jsonFile);
  const errors = [];
  for (const phase of workflow.phases) {
    for (const agent of phase.agents) {
      if (!AGENT_STATUSES.has(agent.status)) errors.push(`${agent.label}: invalid status ${agent.status}`);
      if (agent.status === "completed" && !agent.outputPath) errors.push(`${agent.label}: completed without outputPath`);
      if (agent.outputPath) {
        try {
          relativeOutputPath(agent.outputPath);
        } catch (error) {
          errors.push(`${agent.label}: ${error.message}`);
        }
      }
      if (agent.status === "completed" && agent.outputPath && !fs.existsSync(outputFile(jsonFile, workflow, agent.outputPath))) {
        errors.push(`${agent.label}: missing output file ${agent.outputPath}`);
      }
      if (agent.status === "completed" && agent.cacheKey !== computeCacheKey(workflow, agent)) {
        errors.push(`${agent.label}: stale cache key`);
      }
    }
  }
  return errors;
}

function commandValidate(file) {
  const workflow = loadRun(file);
  const errors = validateRun(workflow, file);
  if (errors.length) {
    console.error("Workflow validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Validated ${workflow.runId}`);
}

function commandRender(file) {
  saveRun(file, loadRun(file));
  console.log(file);
}

function commandSaveTemplate(file, options) {
  if (!options.out) throw new Error("save-template requires --out");
  const workflow = loadRun(file);
  const template = {
    schemaVersion: SCHEMA_VERSION,
    name: workflow.workflowName,
    goal: workflow.goal,
    concurrency: workflow.concurrency,
    source: workflow.source,
    phases: workflow.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      detail: phase.detail,
      approvalRequired: phase.approvalRequired,
      agents: phase.agents.map((agent) => ({
        label: agent.label,
        type: agent.type,
        scope: agent.scope,
        promptPreview: agent.promptPreview,
        outputContract: agent.outputContract,
        dependsOn: agent.dependsOn,
      })),
    })),
    verification: workflow.verification,
  };
  atomicWrite(options.out, `${JSON.stringify(template, null, 2)}\n`);
  console.log(options.out);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  try {
    if (!command || command === "help" || command === "--help") return usage();
    if (command === "init") return commandInit(options);
    if (command === "create") return commandCreate(options);
    if (command === "translate-js") return commandTranslateJs(options._[0], options);
    if (command === "add-agent") return commandAddAgent(options._[0], options);
    if (command === "start-agent") return commandStartAgent(options._[0], options);
    if (command === "finish-agent") return commandFinishAgent(options._[0], options);
    if (command === "fail-agent") return commandFailAgent(options._[0], options);
    if (command === "update-agent") return commandUpdateAgent(options._[0], options);
    if (command === "log") return commandLog(options._[0], options);
    if (command === "status" || command === "progress") return commandStatus(options._[0]);
    if (command === "resume" || command === "resume-plan" || command === "next") return commandResume(options._[0]);
    if (command === "validate") return commandValidate(options._[0]);
    if (command === "render") return commandRender(options._[0]);
    if (command === "save-template") return commandSaveTemplate(options._[0], options);
    throw new Error(`unknown command: ${command}`);
  } catch (error) {
    console.error(`workflow-state: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export {
  createRun,
  loadRun,
  validateRun,
  saveRun,
  renderMarkdown,
  renderProgress,
  getResumePlan,
  parseClaudeWorkflow,
  computeCacheKey,
};
