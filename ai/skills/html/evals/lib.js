// Engine for the /html skill evals.
//
// The durable, reusable core. Each check drives its OWN headless Chromium via
// probe(), so many checks run in parallel as independent processes with zero
// shared state. Everything below is heuristic on purpose: the skill GENERATES
// the UI, so selectors differ every run — we discover the comment UI at runtime
// rather than hardcoding it. See README.md for what that buys and where it can
// misfire.
const { chromium } = require('playwright');

// Run `flow({ page, dragSelect, dragSelectRange, helpers, R })` inside a fresh
// headless browser pointed at fileUrl. Returns the filled-in R result object.
async function probe(fileUrl, flow) {
  const R = {};
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    // Capture whatever the artifact copies, without ever blocking on a clipboard
    // permission prompt (navigator.clipboard.readText hangs under file://).
    await page.addInitScript(() => {
      window.__exported = null;
      try {
        if (navigator.clipboard) {
          navigator.clipboard.writeText = (t) => { window.__exported = String(t); return Promise.resolve(); };
        }
      } catch (e) {}
      const orig = document.execCommand ? document.execCommand.bind(document) : null;
      document.execCommand = (cmd, ...a) => {
        if (cmd === 'copy') {
          const el = document.activeElement;
          if (el && 'value' in el) window.__exported = el.value;
          const sel = window.getSelection && window.getSelection();
          if (sel && String(sel)) window.__exported = String(sel);
        }
        return orig ? orig(cmd, ...a) : false;
      };
    });
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 20000 });
    await flow({ page, dragSelect: dragSelect(page), dragSelectRange: dragSelectRange(page), helpers: helpers(page), R });
  } catch (e) {
    R.error = 'ERROR: ' + (e && e.message ? e.message : String(e));
  } finally {
    try { await browser.close(); } catch (e) {}
  }
  return R;
}

// ---- selection helpers (real mouse drags, so the artifact's own handlers fire) ----

const dragSelect = (page) => async function (substring, containerSel) {
  const rect = await page.evaluate(({ substring, containerSel }) => {
    const root = (containerSel && document.querySelector(containerSel)) || document.body;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.textContent.indexOf(substring);
      if (i !== -1) {
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + substring.length);
        if (n.parentElement) n.parentElement.scrollIntoView({ block: 'center' });
        const b = r.getBoundingClientRect();
        return { x1: b.left + 1, y1: b.top + b.height / 2, x2: b.right - 1, y2: b.bottom - b.height / 2 };
      }
    }
    return null;
  }, { substring, containerSel: containerSel || null });
  if (!rect) throw new Error('dragSelect: text not found: ' + substring);
  await doDrag(page, rect);
  return rect;
};

// Drag from the start of startSub to the end of endSub, which may sit in
// DIFFERENT text nodes — i.e. a selection that crosses element boundaries.
const dragSelectRange = (page) => async function (startSub, endSub, containerSel) {
  const pts = await page.evaluate(({ startSub, endSub, containerSel }) => {
    const root = (containerSel && document.querySelector(containerSel)) || document.body;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    let sNode = null, sIdx = -1, eNode = null, eIdx = -1;
    for (const node of nodes) { const i = node.textContent.indexOf(startSub); if (i !== -1) { sNode = node; sIdx = i; break; } }
    if (!sNode) return null;
    let seen = false;
    for (const node of nodes) {
      if (node === sNode) seen = true;
      if (!seen) continue;
      const j = node.textContent.indexOf(endSub);
      if (j !== -1) { eNode = node; eIdx = j + endSub.length; break; }
    }
    if (!eNode) return null;
    if (sNode.parentElement) sNode.parentElement.scrollIntoView({ block: 'center' });
    const a = document.createRange(); a.setStart(sNode, sIdx); a.setEnd(sNode, sIdx);
    const b = document.createRange(); b.setStart(eNode, eIdx); b.setEnd(eNode, eIdx);
    const full = document.createRange(); full.setStart(sNode, sIdx); full.setEnd(eNode, eIdx);
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return {
      x1: ra.left, y1: (ra.height ? ra.top + ra.height / 2 : ra.top + 7),
      x2: rb.left, y2: (rb.height ? rb.top + rb.height / 2 : rb.top + 7),
      crossesElements: sNode.parentElement !== eNode.parentElement,
      selText: full.toString(),
    };
  }, { startSub, endSub, containerSel: containerSel || null });
  if (!pts) throw new Error('dragSelectRange: endpoints not found (' + startSub + ' .. ' + endSub + ')');
  await doDrag(page, pts);
  return pts;
};

async function doDrag(page, r) {
  await page.mouse.move(r.x1, r.y1);
  await page.mouse.down();
  await page.mouse.move((r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2, { steps: 8 });
  await page.mouse.move(r.x2, r.y2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// ---- generic UI helpers (heuristic discovery of the generated comment UI) ----

const helpers = (page) => ({
  // Find the visible, non-readonly comment composer, preferring one in a
  // floating/popover container with a comment-ish placeholder.
  _composerHandle() {
    return page.evaluateHandle(() => {
      const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 4 && r.height > 4; };
      const cands = [...document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [contenteditable=""]')]
        .filter(vis).filter((el) => !el.readOnly);
      if (!cands.length) return null;
      const score = (el) => {
        let s = 0, p = el, floating = false;
        const ph = (el.getAttribute && (el.getAttribute('placeholder') || '')) || '';
        if (/comment|note|selection|feedback|thought|annot|review/i.test(ph)) s += 3;
        while (p) {
          const pos = getComputedStyle(p).position;
          if (pos === 'fixed' || pos === 'absolute') floating = true;
          const c = ((p.className || '') + ' ' + (p.id || ''));
          if (/pop|comment|annot|tooltip|note|bubble|selection/i.test(c)) s += 2;
          p = p.parentElement;
        }
        if (floating) s += 3;
        if (((el.value || el.textContent || '').trim()) === '') s += 1;
        return s;
      };
      cands.sort((a, b) => score(b) - score(a));
      return cands[0];
    });
  },

  // After a selection is active, find (or reveal) the comment composer, type
  // `text`, and submit it. Returns true if a composer was found and submitted.
  async addComment(text) {
    let el = (await this._composerHandle()).asElement();
    if (!el) {
      // Many UIs show a floating "Comment" button on selection that must be
      // clicked to reveal the composer.
      await this.clickByText(['comment', 'add comment', 'add note', 'note', 'annotate', 'reply']);
      await page.waitForTimeout(200);
      el = (await this._composerHandle()).asElement();
    }
    if (!el) return false;
    const editable = await el.evaluate((n) => n.isContentEditable);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 2000 }).catch(() => {});
    if (editable) { await page.keyboard.type(text); }
    else { await el.fill(text).catch(async () => { await page.keyboard.type(text); }); }
    // Prefer a submit button inside the composer's own container.
    const submitted = await el.evaluate((node, words) => {
      const vis = (e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const re = new RegExp('\\b(' + words.join('|') + ')\\b', 'i');
      let cont = node;
      for (let k = 0; k < 5 && cont.parentElement; k++) cont = cont.parentElement;
      const btns = [...cont.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(vis);
      const m = btns.find((b) => re.test((b.textContent || b.value || '').trim()));
      if (m) { m.click(); return true; }
      return false;
    }, ['save', 'add', 'post', 'submit', 'done', 'apply', 'ok', 'comment']);
    if (!submitted) {
      const g = await this.clickByText(['save', 'add', 'post', 'submit', 'done', 'apply']);
      if (!g) { await page.keyboard.press('Meta+Enter').catch(() => {}); await page.keyboard.press('Enter').catch(() => {}); }
    }
    await page.waitForTimeout(300);
    return true;
  },

  // Click the first visible button/link whose text matches any of `words`.
  // Pass a containerSel to scope the search. Returns the matched label or null.
  async clickByText(words, containerSel) {
    return page.evaluate(({ words, containerSel }) => {
      const vis = (el) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const root = (containerSel && document.querySelector(containerSel)) || document;
      const re = new RegExp('\\b(' + words.join('|') + ')\\b', 'i');
      const btns = [...root.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"]')].filter(vis);
      const m = btns.find((b) => re.test((b.textContent || b.value || b.getAttribute('aria-label') || b.title || '').trim()));
      if (m) { m.click(); return (m.textContent || m.value || m.getAttribute('aria-label') || m.title || '').trim() || 'matched'; }
      return null;
    }, { words, containerSel: containerSel || null });
  },

  // All elements that look like comment highlights, with their text + any id.
  async marks() {
    return page.evaluate(() => {
      const sel = 'mark, [class*="hl"], [class*="highlight"], [class*="mark"], [class*="cmt"], [class*="annot"], [data-comment-id], [data-cmt], [data-cid], [data-anchor], [data-comment]';
      return [...document.querySelectorAll(sel)].map((e) => ({
        tag: e.tagName.toLowerCase(),
        cls: typeof e.className === 'string' ? e.className : '',
        text: (e.textContent || '').slice(0, 200),
      }));
    });
  },

  // Does some highlight element (or the union of them) cover `substring`?
  async highlightCovers(substring) {
    const ms = await this.marks();
    if (ms.some((m) => m.text.includes(substring))) return { ok: true, evidence: 'mark text includes "' + substring + '"' };
    const union = ms.map((m) => m.text).join(' ');
    if (substring.split(/\s+/).every((w) => union.includes(w))) return { ok: true, evidence: 'union of marks covers all words of "' + substring + '"' };
    return { ok: false, evidence: ms.length ? 'marks present but none cover "' + substring + '": ' + JSON.stringify(ms.slice(0, 3)) : 'no highlight elements found' };
  },

  // Edit a comment from `oldText` to `newText`. Edit is often triggered by
  // clicking the highlight (no "Edit" button), so we try that first, then an
  // explicit edit control. `found` is true only when we actually reopened the
  // target comment — confirmed by the composer being prefilled with `oldText`.
  // That gate prevents typing into the wrong (e.g. general-notes) box and
  // reporting a false failure: if we can't reopen it, the result is inconclusive.
  async editComment(oldText, newText) {
    const clickedMark = await page.evaluate(() => {
      const sel = 'mark,[class*="hl"],[class*="highlight"],[class*="cmt"],[data-comment-id],[data-cmt],[data-cid],[data-anchor],[data-comment]';
      const els = [...document.querySelectorAll(sel)];
      if (!els.length) return false;
      els[els.length - 1].click();
      return true;
    });
    await page.waitForTimeout(200);
    if (!clickedMark) await this.clickByText(['edit', 'modify', 'change']);
    await page.waitForTimeout(150);
    const composer = (await this._composerHandle()).asElement();
    if (!composer) return { ok: false, found: false, evidence: 'no composer appeared to edit (clicked mark=' + clickedMark + ')' };
    const cur = await composer.evaluate((n) => (n.value !== undefined ? n.value : n.textContent) || '');
    if (oldText && !cur.includes(oldText)) return { ok: false, found: false, evidence: 'reopened composer not prefilled with the comment (' + JSON.stringify(cur.slice(0, 40)) + ') — could not locate the edit path' };
    const editable = await composer.evaluate((n) => n.isContentEditable);
    await composer.click().catch(() => {});
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    if (editable) { await page.keyboard.type(newText); }
    else { await composer.fill(newText).catch(async () => { await page.keyboard.type(newText); }); }
    await this.clickByText(['save', 'update', 'done', 'apply', 'ok', 'submit']);
    await page.waitForTimeout(250);
    const after = await page.evaluate(({ o, n }) => ({ newInBody: document.body.innerText.includes(n), oldInBody: document.body.innerText.includes(o) }), { o: oldText, n: newText });
    const composerNow = (await this._composerHandle()).asElement();
    const composerVal = composerNow ? await composerNow.evaluate((n) => (n.value !== undefined ? n.value : n.textContent) || '') : '';
    const ok = after.newInBody || composerVal.includes(newText) || (oldText && !after.oldInBody);
    return { ok, found: true, evidence: ok ? 'edit applied (newInBody=' + after.newInBody + ', oldGone=' + (oldText ? !after.oldInBody : 'n/a') + ')' : 'edited text not found after save' };
  },

  // Delete a comment; return true if it disappears. The delete control is often
  // exposed only after clicking the highlight, so we reopen first. We treat
  // either the marker text vanishing OR the highlight count dropping as success
  // (some UIs render only a quote, not the comment text, in the page body).
  async deleteComment(marker) {
    const markSel = 'mark,[class*="highlight"],[class*="hl"],[class*="cmt"],[data-cmt],[data-cid],[data-comment-id],[data-anchor]';
    const before = await page.evaluate(({ t, s }) => ({ inBody: document.body.innerText.includes(t), marks: document.querySelectorAll(s).length }), { t: marker, s: markSel });
    await page.evaluate((s) => { const els = [...document.querySelectorAll(s)]; if (els.length) els[els.length - 1].click(); }, markSel);
    await page.waitForTimeout(150);
    await this.clickByText(['delete', 'remove', 'trash', 'discard']);
    await page.waitForTimeout(150);
    await this.clickByText(['confirm', 'yes', 'delete', 'remove']).catch(() => {});
    await page.waitForTimeout(200);
    const after = await page.evaluate(({ t, s }) => ({ inBody: document.body.innerText.includes(t), marks: document.querySelectorAll(s).length }), { t: marker, s: markSel });
    const found = before.inBody || before.marks > 0; // was there anything to delete?
    const removed = (before.inBody && !after.inBody) || (before.marks > 0 && after.marks < before.marks);
    return { ok: removed, found, evidence: removed ? 'comment removed (marks ' + before.marks + '->' + after.marks + ')' : (found ? 'comment still present after delete (marks ' + before.marks + '->' + after.marks + ')' : 'nothing to delete — no comment/highlight was created first') };
  },

  // Trigger the copy/export-everything control; return what got copied. Export
  // often opens a modal with a readonly textarea instead of writing the
  // clipboard, so we also read any readonly textarea/pre as a fallback.
  async exportAll() {
    const clicked = await this.clickByText(['copy all feedback', 'copy feedback', 'copy review', 'copy all', 'export', 'copy', 'download']);
    await page.waitForTimeout(250);
    let exported = await page.evaluate(() => window.__exported);
    if (!exported) {
      exported = await page.evaluate(() => {
        const ro = [...document.querySelectorAll('textarea[readonly], pre, code')].map((e) => e.value || e.textContent || '').filter(Boolean);
        return ro.sort((a, b) => b.length - a.length)[0] || null;
      });
    }
    if (!exported) {
      await this.clickByText(['copy to clipboard', 'copy']);
      await page.waitForTimeout(150);
      exported = await page.evaluate(() => window.__exported);
    }
    return { clicked, exported: exported || '' };
  },
});

module.exports = { probe };
