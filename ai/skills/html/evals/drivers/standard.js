// Standard driver: runs the common highlight -> comment -> anchor -> edit ->
// delete -> export checks for one eval against one generated artifact.
//
//   node drivers/standard.js <evalId> <artifactPath>
//
// Prints one line of JSON: { <checkKey>: { passed, evidence }, ... }.
// Which checks run is driven by the eval's `checks` array in evals.json.
//
// Each check runs in its OWN fresh headless browser (its own probe call) so one
// check can never corrupt another (e.g. an export modal or a delete leaking
// into the next check). Most evals need no custom driver — add a case to
// evals.json and reuse this one. For exotic behaviors, copy this file and point
// the eval's `driver` at it.
const path = require('path');
const fs = require('fs');
const { probe } = require('../lib.js');

const [, , evalId, artifactPath] = process.argv;
const evals = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals.json'), 'utf8'));
const ev = evals.find((e) => e.id === evalId);
if (!ev) { console.error('unknown eval id: ' + evalId); process.exit(2); }
const fileUrl = 'file://' + path.resolve(artifactPath);
const mark = (suffix) => 'EVAL' + suffix + '_' + evalId.replace(/[^a-z0-9]/gi, '');

// Each check: a fresh-browser flow that returns { passed, evidence }.
const CHECKS = {
  // A comment can be attached to an arbitrary text selection.
  async select({ page, dragSelect, helpers }) {
    await dragSelect(ev.selection);
    const added = await helpers.addComment(mark('W'));
    const inBody = await page.evaluate((t) => document.body.innerText.includes(t), mark('W'));
    const hl = await helpers.highlightCovers(ev.selection);
    const ok = added && (inBody || hl.ok);
    return { passed: ok, evidence: added ? 'comment composer accepted text; ' + (inBody ? 'marker in DOM' : hl.ok ? 'highlight created on selection' : 'but no marker/highlight found') : 'no comment composer appeared after selection' };
  },
  // The comment's highlight wraps the exact selected words (within one element).
  async anchor({ page, dragSelect, helpers }) {
    await dragSelect(ev.selection);
    await helpers.addComment(mark('W'));
    const c = await helpers.highlightCovers(ev.selection);
    return { passed: c.ok, evidence: c.evidence };
  },
  // The highlight survives a selection that crosses an element boundary.
  async crossAnchor({ dragSelectRange, helpers }) {
    if (!ev.crossSelection) return { passed: false, evidence: 'eval has no crossSelection defined' };
    const pts = await dragSelectRange(ev.crossSelection.start, ev.crossSelection.end);
    await helpers.addComment(mark('X'));
    const a = await helpers.highlightCovers(ev.crossSelection.start);
    const b = await helpers.highlightCovers(ev.crossSelection.end);
    const ok = pts.crossesElements && a.ok && b.ok;
    return { passed: ok, evidence: 'crossesElements=' + pts.crossesElements + '; startSide: ' + a.evidence + '; endSide: ' + b.evidence };
  },
  // An existing comment can be edited and the change persists.
  async edit({ dragSelect, helpers }) {
    await dragSelect(ev.selection);
    await helpers.addComment(mark('W'));
    const r = await helpers.editComment(mark('E'));
    return { passed: r.ok, evidence: r.evidence };
  },
  // An existing comment can be deleted.
  async delete({ dragSelect, helpers }) {
    await dragSelect(ev.selection);
    await helpers.addComment(mark('W'));
    const r = await helpers.deleteComment(mark('W'));
    return { passed: r.ok, evidence: r.evidence };
  },
  // The single copy/export control emits everything entered, incl. the comment.
  async export({ dragSelect, helpers }) {
    await dragSelect(ev.selection);
    await helpers.addComment(mark('W'));
    const { clicked, exported } = await helpers.exportAll();
    const ok = !!exported && exported.includes(mark('W'));
    return { passed: ok, evidence: clicked ? (ok ? 'export output contains the comment' : 'export control ("' + clicked + '") fired but output missing comment; got: ' + String(exported).slice(0, 120)) : 'no copy/export control found' };
  },
};

(async () => {
  const result = {};
  for (const key of ev.checks) {
    if (!CHECKS[key]) { result[key] = { passed: false, evidence: 'unknown check' }; continue; }
    try {
      const r = await probe(fileUrl, async (ctx) => { Object.assign(ctx.R, await CHECKS[key](ctx)); });
      result[key] = r && r.error ? { passed: false, evidence: r.error } : (r && 'passed' in r ? r : { passed: false, evidence: 'no result' });
    } catch (e) {
      result[key] = { passed: false, evidence: 'threw: ' + (e && e.message ? e.message : String(e)) };
    }
  }
  process.stdout.write(JSON.stringify(result));
})();
