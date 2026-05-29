#!/usr/bin/env node
// Orchestrator. Runs each active eval's driver against its generated
// artifact(s), in parallel, and prints a pass/fail table.
//
//   node run.js                 # all active evals
//   node run.js --smoke         # just the eval flagged "smoke": true (fast canary)
//   node run.js --eval <id>     # one eval
//   node run.js --prompts       # print the generation prompts for missing artifacts
//
// Generation (running the skill to produce the HTML) is the stochastic, model-
// driven step and is NOT done here — see README.md. Drop generated files into
// artifacts/<evalId>/ (one or more, for a pass RATE) or artifacts/<evalId>.html.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const ROOT = __dirname;
const evals = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

function artifactsFor(id) {
  const dir = path.join(ROOT, 'artifacts', id);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f));
  }
  const single = path.join(ROOT, 'artifacts', id + '.html');
  return fs.existsSync(single) ? [single] : [];
}

function selectEvals() {
  let list = evals.filter((e) => e.status === 'active');
  if (opt('--eval')) list = evals.filter((e) => e.id === opt('--eval'));
  if (flag('--smoke')) { const s = list.filter((e) => e.smoke); if (s.length) list = [s[0]]; else list = list.slice(0, 1); }
  return list;
}

function genPrompt(ev) {
  return 'Run the /html skill on ' + path.join('evals', ev.subject) + ' (a ' + ev.kind + ') and save the artifact to ' +
    path.join('evals', 'artifacts', ev.id, 'r1.html') + '. For a pass rate, repeat into r2.html, r3.html, ...';
}

if (flag('--prompts')) {
  console.log('Generation prompts (feed each to Claude with the /html skill):\n');
  for (const ev of selectEvals()) console.log('- [' + ev.id + '] ' + genPrompt(ev));
  process.exit(0);
}

function runDriver(ev, artifactPath) {
  const driver = path.join(ROOT, 'drivers', ev.driver || 'standard.js');
  return new Promise((resolve) => {
    execFile('node', [driver, ev.id, artifactPath], { cwd: ROOT, timeout: 90000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      let parsed = null;
      try { parsed = JSON.parse((stdout || '').trim()); } catch (e) {}
      resolve({ artifact: path.basename(artifactPath), result: parsed, raw: stdout, err: err ? (stderr || err.message) : null });
    });
  });
}

async function pool(tasks, limit) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) || 0 }, async () => {
    while (i < tasks.length) { const idx = i++; out[idx] = await tasks[idx](); }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  const chosen = selectEvals();
  const jobs = [];
  const missing = [];
  for (const ev of chosen) {
    const arts = artifactsFor(ev.id);
    if (!arts.length) { missing.push(ev); continue; }
    for (const a of arts) jobs.push({ ev, a });
  }

  if (missing.length) {
    console.log('\nNo artifacts found for: ' + missing.map((e) => e.id).join(', '));
    console.log('Generate them first (run `node run.js --prompts` for the exact prompts), then re-run.\n');
    if (!jobs.length) process.exit(1);
  }

  const runs = await pool(jobs.map(({ ev, a }) => () => runDriver(ev, a)), 8);

  // tally per eval per check: pass / fail / inconclusive
  const tally = {};
  runs.forEach((r, k) => {
    const ev = jobs[k].ev;
    tally[ev.id] = tally[ev.id] || { name: ev.name, checks: {}, total: 0, errors: [] };
    const t = tally[ev.id];
    t.total += 1;
    if (!r.result) { t.errors.push(r.artifact + ': ' + (r.err || 'no JSON output')); return; }
    if (r.result.error) t.errors.push(r.artifact + ': ' + r.result.error);
    for (const key of ev.checks) {
      t.checks[key] = t.checks[key] || { pass: 0, fail: 0, inc: 0 };
      const c = r.result[key];
      if (c && c.passed) t.checks[key].pass += 1;
      else if (c && c.inconclusive) t.checks[key].inc += 1;
      else t.checks[key].fail += 1;
    }
  });

  console.log('\n=== /html skill eval results ===   (✓ pass · ✗ fail · ? inconclusive = verifier could not drive; confirm agent-side)');
  for (const id of Object.keys(tally)) {
    const t = tally[id];
    const cells = Object.keys(t.checks).map((k) => {
      const c = t.checks[k];
      const parts = [];
      if (c.pass) parts.push('✓' + c.pass);
      if (c.fail) parts.push('✗' + c.fail);
      if (c.inc) parts.push('?' + c.inc);
      return k + ' ' + (parts.join(' ') || '–');
    });
    console.log('\n' + id + ' — ' + t.name);
    console.log('  ' + (cells.join('   ') || '(no checks)'));
    if (t.errors.length) t.errors.forEach((e) => console.log('  ! ' + e));
  }

  // persist
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(ROOT, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const detail = jobs.map(({ ev, a }, k) => ({ eval: ev.id, artifact: path.basename(a), result: runs[k].result, err: runs[k].err }));
  fs.writeFileSync(path.join(outDir, stamp + '.json'), JSON.stringify({ when: stamp, tally, detail }, null, 2));
  console.log('\nSaved results/' + stamp + '.json\n');
})();
