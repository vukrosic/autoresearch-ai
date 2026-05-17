#!/usr/bin/env python3
"""Tiny zero-dep web dashboard for the autoresearch-ai agent-runner.

Browser-friendly tail -f over every file in state/, plus a quick view of
worktrees and recent commits. Run with:

    python3 researchloop-dev/agent-runner/dashboard.py [PORT]

Opens at http://localhost:7777 by default. Localhost-only, no auth.
"""
import http.server
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = REPO_ROOT / "researchloop-dev" / "agent-runner" / "state"
WORKTREES_DIR = REPO_ROOT / ".agent-worktrees"

INDEX_HTML = r"""<!doctype html>
<html><head><meta charset="utf-8"><title>autoresearch-ai · agent-runner</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
<style>
body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0;background:#0d1117;color:#c9d1d9;height:100vh;overflow:hidden;}
header{padding:12px 18px;border-bottom:1px solid #30363d;background:#161b22;display:flex;gap:18px;align-items:center;flex-wrap:wrap;}
header h1{margin:0;font-size:15px;color:#f0f6fc;font-weight:600;}
header span{color:#8b949e;font-size:12px;}
main{display:grid;grid-template-columns:340px 1fr;height:calc(100vh - 50px);}
aside{border-right:1px solid #30363d;overflow-y:auto;background:#0d1117;}
aside h2{font-size:11px;text-transform:uppercase;color:#8b949e;letter-spacing:0.08em;margin:14px 18px 6px;display:flex;justify-content:space-between;align-items:center;}
aside h2 .count{color:#6e7681;font-weight:normal;text-transform:none;letter-spacing:0;}
aside .file{padding:6px 18px;cursor:pointer;border-left:3px solid transparent;font-size:13px;}
aside .file:hover{background:#161b22;}
aside .file.active{background:#161b22;border-left-color:#1f6feb;color:#58a6ff;}
aside .meta{font-size:11px;color:#6e7681;margin-left:8px;}
section{display:flex;flex-direction:column;overflow:hidden;background:#000;}
section h2{margin:0;padding:10px 18px;border-bottom:1px solid #30363d;font-size:13px;background:#0d1117;display:flex;justify-content:space-between;align-items:center;}
section h2 .ctl{font-size:11px;color:#8b949e;font-weight:400;}
section h2 button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;margin-left:6px;}
section h2 button.on{background:#1f6feb;color:#fff;border-color:#1f6feb;}
#term-wrap{flex:1;padding:8px;overflow:hidden;background:#000;}
.xterm{height:100%;}
#hint{padding:40px;color:#6e7681;text-align:center;background:#000;}
.empty{padding:40px 18px;color:#6e7681;text-align:center;}
.worktree{padding:8px 18px;font-size:12px;border-bottom:1px solid #21262d;}
.worktree .name{color:#58a6ff;}
.worktree .commits{color:#8b949e;font-size:11px;margin-top:2px;}
.worktree.live .name::before{content:"● ";color:#3fb950;animation:pulse 1.2s infinite;}
@keyframes pulse{50%{opacity:0.4;}}
.filters{padding:0 18px 8px;display:flex;gap:4px;flex-wrap:wrap;}
.filters button{background:#0d1117;color:#8b949e;border:1px solid #30363d;border-radius:12px;padding:3px 10px;cursor:pointer;font-size:11px;font-family:inherit;}
.filters button:hover{color:#c9d1d9;}
.filters button.on{background:#1f6feb;color:#fff;border-color:#1f6feb;}
.issue,.pr{padding:10px 18px;border-bottom:1px solid #21262d;font-size:12px;}
.issue .num,.pr .num{color:#8b949e;}
.issue .ttl,.pr .ttl{color:#c9d1d9;margin-bottom:6px;}
.issue.busy .ttl::before{content:"⏳ ";color:#d29922;}
.issue.parked .ttl{color:#6e7681;}
.issue .lbls,.pr .lbls{font-size:10px;color:#6e7681;margin-bottom:6px;}
.issue .lbls .lbl,.pr .lbls .lbl{display:inline-block;background:#161b22;padding:1px 6px;border-radius:8px;margin-right:3px;color:#8b949e;}
.issue .lbls .lbl.claim-next{background:#0e3a1a;color:#3fb950;}
.issue .lbls .lbl.in-progress{background:#3a2f0e;color:#d29922;}
.issue .lbls .lbl.needs-validation{background:#222;color:#6e7681;}
.issue .lbls .lbl.keystone{background:#4a0f2a;color:#f778ba;}
.issue .row,.pr .row{display:flex;gap:6px;flex-wrap:wrap;}
.issue button,.pr button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;font-family:inherit;flex:1;}
.issue button:hover:not(:disabled),.pr button:hover:not(:disabled){background:#1f6feb;color:#fff;border-color:#1f6feb;}
.issue button:disabled,.pr button:disabled{opacity:0.4;cursor:not-allowed;}
.issue button.headless{background:#0d1117;}
.pr .badges{font-size:10px;color:#6e7681;margin-bottom:6px;}
.pr .badges .b{display:inline-block;padding:1px 6px;border-radius:3px;margin-right:4px;background:#161b22;}
.pr .badges .b.draft{color:#8b949e;}
.pr .badges .b.approved{background:#0e3a1a;color:#3fb950;}
.pr .badges .b.changes_requested{background:#4a0e0e;color:#ff7b72;}
.pr .badges .b.ci-pass{background:#0e3a1a;color:#3fb950;}
.pr .badges .b.ci-fail{background:#4a0e0e;color:#ff7b72;}
.pr .badges .b.ci-pending{background:#3a2f0e;color:#d29922;}
.pr button.merge{background:#1a3a1a;color:#56d364;border-color:#234a23;}
.pr button.merge:hover:not(:disabled){background:#0e6e0e;color:#fff;border-color:#0e6e0e;}
.pr button.review{background:#1a1a3a;color:#79c0ff;border-color:#23234a;}
.pr button.review:hover:not(:disabled){background:#0e2e6e;color:#fff;border-color:#0e2e6e;}
#toast{position:fixed;bottom:20px;right:20px;background:#161b22;color:#c9d1d9;padding:10px 16px;border-radius:6px;border:1px solid #30363d;font-size:12px;display:none;z-index:100;}
#toast.err{border-color:#f85149;color:#ff7b72;}
#toast.ok{border-color:#3fb950;color:#56d364;}
</style></head>
<body>
<header>
  <h1>autoresearch-ai · agent-runner</h1>
  <span id="lastUpdate">—</span>
  <span>Files list refreshes every 5s · Terminal streams new bytes every 800ms when followed</span>
</header>
<main>
  <aside>
    <h2>Open PRs <span class="count" id="prCount"></span></h2>
    <div id="prs"><div class="empty">loading…</div></div>
    <h2>Issues <span class="count" id="issueCount"></span></h2>
    <div class="filters" id="filters">
      <button data-f="claim-next" class="on">claim-next</button>
      <button data-f="all">all</button>
      <button data-f="good first issue">good first</button>
      <button data-f="agent-friendly">agent</button>
      <button data-f="needs-validation">parked</button>
    </div>
    <div id="issues"><div class="empty">loading…</div></div>
    <h2>Active worktrees</h2>
    <div id="worktrees"><div class="empty">none</div></div>
    <h2>State files</h2>
    <div id="files"><div class="empty">scanning…</div></div>
  </aside>
  <div id="toast"></div>
  <section>
    <h2><span id="title">pick a file →</span>
      <span class="ctl">
        <button id="followBtn" class="on">follow ▾</button>
        <button id="replayBtn">replay</button>
        <button id="clearBtn">clear</button>
      </span>
    </h2>
    <div id="term-wrap"><div id="hint">Pick a file from the left to open it as a terminal session.<br><br>Logs from running agents will auto-update.<br>Click "replay" to re-play a completed log from byte zero with a typing animation.</div></div>
  </section>
</main>
<script>
const term = new Terminal({
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  theme: {
    background: '#000000', foreground: '#c9d1d9', cursor: '#58a6ff',
    black:'#484f58', red:'#ff7b72', green:'#3fb950', yellow:'#d29922',
    blue:'#58a6ff', magenta:'#bc8cff', cyan:'#39c5cf', white:'#b1bac4',
    brightBlack:'#6e7681', brightRed:'#ffa198', brightGreen:'#56d364', brightYellow:'#e3b341',
    brightBlue:'#79c0ff', brightMagenta:'#d2a8ff', brightCyan:'#56d4dd', brightWhite:'#f0f6fc'
  },
  convertEol: true, scrollback: 50000, cursorBlink: false, disableStdin: true
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.loadAddon(new WebLinksAddon.WebLinksAddon());

let termAttached = false;
function attachTerm() {
  if (termAttached) return;
  const wrap = document.getElementById('term-wrap');
  wrap.innerHTML = '';
  term.open(wrap);
  fitAddon.fit();
  termAttached = true;
  window.addEventListener('resize', () => fitAddon.fit());
}

let current = null;
let cursor = 0;        // bytes already written to the terminal
let follow = true;
let pollTimer = null;
let replayMode = false;

function fmtSize(n){if(n<1024)return n+'B';if(n<1024*1024)return (n/1024).toFixed(1)+'K';return (n/1048576).toFixed(1)+'M';}
function fmtTime(s){const d=new Date(s*1000);return d.toLocaleTimeString();}

async function listFiles() {
  try {
    const r = await fetch('/api/files');
    const data = await r.json();
    const el = document.getElementById('files');
    if (!data.files.length) { el.innerHTML = '<div class="empty">no logs yet</div>'; }
    else {
      el.innerHTML = data.files.map(f => {
        const cls = (f.name === current) ? 'file active' : 'file';
        const safeName = f.name.replace(/'/g, "\\'");
        return `<div class="${cls}" data-name="${f.name}" onclick="selectFile('${safeName}')">${f.name}<span class="meta">${fmtSize(f.size)} · ${fmtTime(f.mtime)}</span></div>`;
      }).join('');
    }
    document.getElementById('lastUpdate').textContent = 'updated ' + new Date().toLocaleTimeString();
  } catch(e) { console.error(e); }
}

async function listWorktrees() {
  try {
    const r = await fetch('/api/worktrees');
    const data = await r.json();
    const el = document.getElementById('worktrees');
    const runningSet = new Set((data.running || []).filter(r => r.active).map(r => r.worktree));
    if (!data.worktrees.length) { el.innerHTML = '<div class="empty">none</div>'; }
    else {
      el.innerHTML = data.worktrees.map(w =>
        `<div class="worktree ${runningSet.has(w.name) ? 'live' : ''}"><div class="name">${w.name}</div><div class="commits">${w.commits || 'no commits yet'} · ${w.dirty ? 'uncommitted edits' : 'clean'}${runningSet.has(w.name) ? ' · agent active' : ''}</div></div>`
      ).join('');
    }
  } catch(e) { console.error(e); }
}

let issueFilter = 'claim-next';
let allIssues = [];

async function listIssues() {
  try {
    const r = await fetch('/api/issues');
    const data = await r.json();
    if (data.issues && data.issues[0] && data.issues[0].error) {
      document.getElementById('issues').innerHTML = `<div class="empty">gh error: ${data.issues[0].error}</div>`;
      return;
    }
    allIssues = data.issues || [];
    document.getElementById('issueCount').textContent = `${allIssues.length} open`;
    renderIssues();
  } catch(e) { console.error(e); }
}

function renderIssues() {
  const el = document.getElementById('issues');
  const filtered = issueFilter === 'all'
    ? allIssues
    : allIssues.filter(it => it.labels.includes(issueFilter));
  if (!filtered.length) { el.innerHTML = `<div class="empty">no issues match "${issueFilter}"</div>`; return; }
  el.innerHTML = filtered.map(it => {
    const interesting = it.labels.filter(l => ['claim-next','in-progress','needs-validation','keystone','good first issue','agent-friendly'].includes(l));
    const labelChips = interesting.map(l => `<span class="lbl ${l.replace(/[^a-z0-9-]/g,'-')}">${l}</span>`).join('');
    return `
      <div class="issue ${it.in_progress ? 'busy' : ''} ${it.parked ? 'parked' : ''}">
        <div class="ttl"><span class="num">#${it.number}</span> ${escapeHtml(it.title)}</div>
        ${labelChips ? `<div class="lbls">${labelChips}</div>` : ''}
        <div class="row">
          <button onclick="launchIssue(${it.number}, 'watch')" ${it.in_progress ? 'disabled' : ''} title="Spawn orchestrator and auto-switch terminal to its log">▶ launch & watch</button>
          <button class="headless" onclick="launchIssue(${it.number}, 'headless')" ${it.in_progress ? 'disabled' : ''} title="Spawn orchestrator in background; don't switch terminal view">⌁ headless</button>
        </div>
      </div>
    `;
  }).join('');
}

async function listPRs() {
  try {
    const r = await fetch('/api/prs');
    const data = await r.json();
    const el = document.getElementById('prs');
    if (data.prs && data.prs[0] && data.prs[0].error) {
      el.innerHTML = `<div class="empty">gh error: ${data.prs[0].error}</div>`;
      return;
    }
    document.getElementById('prCount').textContent = `${data.prs.length} open`;
    if (!data.prs.length) { el.innerHTML = '<div class="empty">no open PRs</div>'; return; }
    el.innerHTML = data.prs.map(pr => {
      const decision = pr.reviewDecision || '';
      const decBadge = decision ? `<span class="b ${decision.toLowerCase()}">${decision.replace('_',' ').toLowerCase()}</span>` : '';
      const ciBadge = `<span class="b ci-${pr.ci}">CI: ${pr.ci}</span>`;
      const draftBadge = pr.isDraft ? '<span class="b draft">draft</span>' : '';
      const mergeable = pr.mergeable === 'MERGEABLE';
      const mergeDisabled = !mergeable || pr.isDraft || decision === 'CHANGES_REQUESTED';
      return `
        <div class="pr">
          <div class="ttl"><span class="num">#${pr.number}</span> ${escapeHtml(pr.title)}</div>
          <div class="badges">${draftBadge}${decBadge}${ciBadge}</div>
          <div class="row">
            <button class="review" onclick="reviewPR(${pr.number})" title="Spawn reviewer agent (Claude). Posts a structured verdict comment.">🔍 review</button>
            <button class="merge" onclick="mergePR(${pr.number})" ${mergeDisabled ? 'disabled' : ''} title="${mergeDisabled ? 'PR is draft / not mergeable / changes requested' : 'gh pr merge --squash --delete-branch'}">✓ squash-merge</button>
            <button onclick="viewPRDiff(${pr.number})" title="Show the diff in the terminal pane">view diff</button>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) { console.error(e); }
}

async function reviewPR(num) {
  showToast(`spawning reviewer on PR #${num}…`, '');
  try {
    const r = await fetch('/api/review', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pr: num})
    });
    const data = await r.json();
    if (data.error) { showToast(`error: ${data.error}`, 'err'); return; }
    showToast(`reviewer spawned on #${num} → tail review-${num}.md when done`, 'ok');
    // Auto-switch to the review-spawn log so user can watch
    setTimeout(() => { listFiles(); selectFile(data.log); }, 1500);
  } catch(e) { showToast(`review failed: ${e}`, 'err'); }
}

async function mergePR(num) {
  if (!confirm(`Squash-merge PR #${num} into main and delete the branch? This is final.`)) return;
  showToast(`merging PR #${num}…`, '');
  try {
    const r = await fetch('/api/merge', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pr: num, strategy: 'squash'})
    });
    const data = await r.json();
    if (data.error) { showToast(`merge error: ${data.error}`, 'err'); return; }
    showToast(`✓ merged #${num} (squash)`, 'ok');
    listPRs(); listIssues();
  } catch(e) { showToast(`merge failed: ${e}`, 'err'); }
}

async function viewPRDiff(num) {
  // Spawn nothing — just write the diff to a state file and open it.
  showToast(`fetching diff for #${num}…`, '');
  try {
    const r = await fetch('/api/file?name=pr-' + num + '.diff');
    if (r.status === 404) {
      showToast(`no cached diff for #${num} — run review first`, 'err');
      return;
    }
    selectFile(`pr-${num}.diff`);
  } catch(e) { console.error(e); }
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function showToast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = kind || '';
  t.style.display = 'block';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.style.display = 'none', 5000);
}

async function launchIssue(num, mode) {
  showToast(`launching issue #${num} (${mode})…`, '');
  try {
    const r = await fetch('/api/launch', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({issue: num, mode})
    });
    const data = await r.json();
    if (data.error) {
      showToast(`error: ${data.error}`, 'err');
      return;
    }
    showToast(`spawned on #${num} → ${data.implementer_log}`, 'ok');
    if (mode === 'watch') {
      // Wait briefly for the log file to appear, then auto-select it.
      setTimeout(() => selectFile(data.implementer_log), 1500);
    }
    listIssues();
    listFiles();
    listWorktrees();
  } catch(e) {
    showToast(`launch failed: ${e}`, 'err');
  }
}

function selectFile(name) {
  current = name;
  cursor = 0;
  replayMode = false;
  document.getElementById('title').textContent = name;
  document.querySelectorAll('aside .file').forEach(el => el.classList.toggle('active', el.dataset.name === name));
  attachTerm();
  term.reset();
  if (pollTimer) clearInterval(pollTimer);
  pollOnce();
  if (follow) pollTimer = setInterval(pollOnce, 800);
}

async function pollOnce() {
  if (!current || replayMode) return;
  try {
    const r = await fetch('/api/file?name=' + encodeURIComponent(current) + '&offset=' + cursor);
    const text = await r.text();
    if (text.length > 0) {
      term.write(text);
      cursor += new TextEncoder().encode(text).length;
      if (follow) term.scrollToBottom();
    }
  } catch(e) { console.error(e); }
}

async function replay() {
  if (!current) return;
  if (pollTimer) clearInterval(pollTimer);
  replayMode = true;
  term.reset();
  cursor = 0;
  document.getElementById('replayBtn').classList.add('on');
  try {
    const r = await fetch('/api/file?name=' + encodeURIComponent(current));
    const text = await r.text();
    // Replay at ~10000 chars/sec for visual effect
    const chunkSize = 200;
    for (let i = 0; i < text.length; i += chunkSize) {
      term.write(text.slice(i, i + chunkSize));
      term.scrollToBottom();
      if (i % 4000 === 0) await new Promise(rs => setTimeout(rs, 8));
    }
    cursor = new TextEncoder().encode(text).length;
  } catch(e) { console.error(e); }
  document.getElementById('replayBtn').classList.remove('on');
  replayMode = false;
  if (follow) pollTimer = setInterval(pollOnce, 800);
}

document.getElementById('followBtn').onclick = (e) => {
  follow = !follow;
  e.target.classList.toggle('on', follow);
  e.target.textContent = 'follow ' + (follow ? '▾' : '·');
  if (pollTimer) clearInterval(pollTimer);
  if (follow && current && !replayMode) pollTimer = setInterval(pollOnce, 800);
};
document.getElementById('replayBtn').onclick = replay;
document.getElementById('clearBtn').onclick = () => { if (termAttached) { term.reset(); cursor = 0; } };

// Filter chip handlers
document.getElementById('filters').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  issueFilter = e.target.dataset.f;
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === issueFilter));
  renderIssues();
});

listFiles(); listWorktrees(); listIssues(); listPRs();
setInterval(listFiles, 5000);
setInterval(listWorktrees, 4000);
setInterval(listIssues, 20000);
setInterval(listPRs, 15000);
</script>
</body></html>"""


def list_state_files():
    if not STATE_DIR.exists():
        return []
    out = []
    for p in sorted(STATE_DIR.iterdir(), key=lambda x: -x.stat().st_mtime):
        if p.name.startswith(".") or p.is_dir():
            continue
        st = p.stat()
        out.append({"name": p.name, "size": st.st_size, "mtime": st.st_mtime})
    return out


# Simple in-memory caches so panels don't hammer the gh API.
_ISSUES_CACHE = {"ts": 0, "data": None}
_PRS_CACHE = {"ts": 0, "data": None}


def list_issues():
    if _ISSUES_CACHE["data"] and time.time() - _ISSUES_CACHE["ts"] < 20:
        return _ISSUES_CACHE["data"]
    try:
        out = subprocess.run(
            ["gh", "issue", "list", "--state", "open",
             "--limit", "100", "--json", "number,title,labels,url"],
            capture_output=True, text=True, timeout=20, check=True,
        ).stdout
        issues = json.loads(out)
        for it in issues:
            it["labels"] = [l["name"] for l in it.get("labels", [])]
            it["in_progress"] = "in-progress" in it["labels"]
            it["claim_next"] = "claim-next" in it["labels"]
            it["parked"] = "needs-validation" in it["labels"]
        _ISSUES_CACHE.update({"ts": time.time(), "data": issues})
        return issues
    except Exception as e:
        return [{"error": str(e)}]


def list_prs():
    if _PRS_CACHE["data"] and time.time() - _PRS_CACHE["ts"] < 20:
        return _PRS_CACHE["data"]
    try:
        out = subprocess.run(
            ["gh", "pr", "list", "--state", "open", "--limit", "60",
             "--json", "number,title,isDraft,headRefName,reviewDecision,mergeable,labels,statusCheckRollup"],
            capture_output=True, text=True, timeout=20, check=True,
        ).stdout
        prs = json.loads(out)
        for pr in prs:
            pr["labels"] = [l["name"] for l in pr.get("labels", [])]
            # rollup CI state
            checks = pr.get("statusCheckRollup") or []
            ci_states = [(c.get("conclusion") or c.get("status") or "").upper() for c in checks]
            if not ci_states:
                pr["ci"] = "none"
            elif any(s == "FAILURE" for s in ci_states):
                pr["ci"] = "fail"
            elif all(s in ("SUCCESS", "COMPLETED", "NEUTRAL", "SKIPPED") for s in ci_states):
                pr["ci"] = "pass"
            else:
                pr["ci"] = "pending"
            del pr["statusCheckRollup"]
        _PRS_CACHE.update({"ts": time.time(), "data": prs})
        return prs
    except Exception as e:
        return [{"error": str(e)}]


def invalidate_caches():
    _ISSUES_CACHE["ts"] = 0
    _PRS_CACHE["ts"] = 0


def spawn_review(pr_num: int):
    if not (1 <= pr_num <= 9999):
        return {"error": "bad pr number"}
    script = REPO_ROOT / "researchloop-dev" / "agent-runner" / "orchestrate.sh"
    log_file = STATE_DIR / f"review-spawn-{pr_num}.out"
    try:
        fh = open(log_file, "w")
        subprocess.Popen(
            [str(script), "--review", str(pr_num)],
            cwd=str(REPO_ROOT),
            stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        return {"error": f"spawn failed: {e}"}
    invalidate_caches()
    return {"started": True, "pr": pr_num, "log": f"review-spawn-{pr_num}.out"}


def merge_pr(pr_num: int, strategy: str = "squash"):
    if not (1 <= pr_num <= 9999):
        return {"error": "bad pr number"}
    if strategy not in ("squash", "merge", "rebase"):
        return {"error": "bad strategy"}
    try:
        # gh pr merge handles draft check internally; --squash is the safest default.
        result = subprocess.run(
            ["gh", "pr", "merge", str(pr_num), f"--{strategy}", "--delete-branch"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return {"error": (result.stderr or result.stdout or "merge failed").strip()}
    except Exception as e:
        return {"error": f"merge failed: {e}"}
    invalidate_caches()
    return {"merged": True, "pr": pr_num, "strategy": strategy, "output": result.stdout.strip()}


def list_running_orchestrators():
    """Find issue numbers currently being worked by checking for live worktrees with no commits OR active log mtime within last 60s."""
    out = []
    if not WORKTREES_DIR.exists():
        return out
    now = time.time()
    for p in sorted(WORKTREES_DIR.iterdir()):
        if not p.is_dir():
            continue
        m = re.match(r"(\d+)-", p.name)
        if not m:
            continue
        issue_num = m.group(1)
        log = STATE_DIR / f"implementer-{issue_num}.log"
        active = log.exists() and (now - log.stat().st_mtime) < 60
        out.append({"issue": issue_num, "worktree": p.name, "active": active})
    return out


def launch_orchestrator(issue_num: int, mode: str):
    """Spawn the orchestrator on an issue. mode is 'watch' or 'headless' — same effect; the flag is forwarded to clients so the UI knows whether to auto-switch."""
    if mode not in ("watch", "headless"):
        return {"error": "bad mode"}
    if not (1 <= issue_num <= 9999):
        return {"error": "bad issue number"}

    script = REPO_ROOT / "researchloop-dev" / "agent-runner" / "orchestrate.sh"
    if not script.exists():
        return {"error": "orchestrate.sh missing"}

    log_file = STATE_DIR / f"orchestrator-{issue_num}.out"
    # If a fresh worktree exists, refuse — the orchestrator will refuse anyway.
    wt = WORKTREES_DIR / f"{issue_num}-*"
    import glob
    if glob.glob(str(wt)):
        return {"error": f"a worktree for issue {issue_num} already exists; clean it up first"}

    # Spawn the orchestrator detached. Use setsid so it survives the dashboard restarting.
    env = os.environ.copy()
    env.setdefault("AGENT_TIMEOUT", "1500")
    try:
        # nohup + & via the parent shell, but call the script directly via subprocess.Popen.
        fh = open(log_file, "w")
        subprocess.Popen(
            [str(script), str(issue_num)],
            cwd=str(REPO_ROOT),
            stdout=fh, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
    except Exception as e:
        return {"error": f"spawn failed: {e}"}

    # Invalidate issues cache so the in_progress label shows up fast.
    _ISSUES_CACHE["ts"] = 0
    return {
        "started": True,
        "issue": issue_num,
        "mode": mode,
        "orchestrator_log": f"orchestrator-{issue_num}.out",
        "implementer_log": f"implementer-{issue_num}.log",
    }


def list_worktrees():
    if not WORKTREES_DIR.exists():
        return []
    out = []
    for p in sorted(WORKTREES_DIR.iterdir()):
        if not p.is_dir():
            continue
        try:
            commits = subprocess.run(
                ["git", "-C", str(p), "log", "--oneline", "origin/main..HEAD"],
                capture_output=True, text=True, timeout=5
            ).stdout.strip()
            dirty = bool(subprocess.run(
                ["git", "-C", str(p), "status", "--porcelain"],
                capture_output=True, text=True, timeout=5
            ).stdout.strip())
            commits_str = commits.split("\n")[0] if commits else ""
            if commits and len(commits.split("\n")) > 1:
                commits_str += f" (+{len(commits.split(chr(10))) - 1} more)"
            out.append({"name": p.name, "commits": commits_str, "dirty": dirty})
        except Exception as e:
            out.append({"name": p.name, "commits": f"(error: {e})", "dirty": False})
    return out


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter
        pass

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/" or u.path == "/index.html":
            body = INDEX_HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/api/files":
            return self._send_json({"files": list_state_files()})
        if u.path == "/api/worktrees":
            return self._send_json({"worktrees": list_worktrees(), "running": list_running_orchestrators()})
        if u.path == "/api/issues":
            return self._send_json({"issues": list_issues()})
        if u.path == "/api/prs":
            return self._send_json({"prs": list_prs()})
        if u.path == "/api/file":
            qs = dict(p.split("=", 1) for p in (u.query.split("&") if u.query else []) if "=" in p)
            name = unquote(qs.get("name", ""))
            offset = max(0, int(qs.get("offset", "0") or 0))
            if not name or "/" in name or ".." in name:
                return self._send_json({"error": "bad name"}, 400)
            fp = STATE_DIR / name
            if not fp.exists() or not fp.is_file():
                return self._send_json({"error": "not found"}, 404)
            size = fp.stat().st_size
            if offset >= size:
                body = b""
            else:
                with fp.open("rb") as fh:
                    fh.seek(offset)
                    data = fh.read()
                # If client is starting fresh on a huge file, only send the last 2MB so the
                # browser doesn't get hammered. Incremental polls (offset > 0) always send all.
                if offset == 0 and len(data) > 2_000_000:
                    data = b"[\xe2\x80\xa6truncated to last 2MB\xe2\x80\xa6]\n" + data[-2_000_000:]
                body = data
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Total-Size", str(size))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length).decode() if content_length else ""
        try:
            payload = json.loads(body or "{}")
        except json.JSONDecodeError:
            return self._send_json({"error": "bad json"}, 400)

        if u.path == "/api/launch":
            try:
                issue = int(payload.get("issue"))
            except (TypeError, ValueError):
                return self._send_json({"error": "issue must be int"}, 400)
            mode = payload.get("mode", "watch")
            result = launch_orchestrator(issue, mode)
            return self._send_json(result, 200 if result.get("started") else 400)

        if u.path == "/api/review":
            try:
                pr = int(payload.get("pr"))
            except (TypeError, ValueError):
                return self._send_json({"error": "pr must be int"}, 400)
            result = spawn_review(pr)
            return self._send_json(result, 200 if result.get("started") else 400)

        if u.path == "/api/merge":
            try:
                pr = int(payload.get("pr"))
            except (TypeError, ValueError):
                return self._send_json({"error": "pr must be int"}, 400)
            strategy = payload.get("strategy", "squash")
            result = merge_pr(pr, strategy)
            return self._send_json(result, 200 if result.get("merged") else 400)

        self.send_response(404)
        self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7777
    bind = ("127.0.0.1", port)
    print(f"agent-runner dashboard: http://localhost:{port}", flush=True)
    print(f"  state dir:   {STATE_DIR}", flush=True)
    print(f"  worktrees:   {WORKTREES_DIR}", flush=True)
    http.server.ThreadingHTTPServer(bind, Handler).serve_forever()


if __name__ == "__main__":
    main()
