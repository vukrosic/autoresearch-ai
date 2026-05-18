#!/usr/bin/env python3
"""Tiny zero-dep web dashboard for the autoresearch-ai agent-runner.

Browser-friendly tail -f over every file in state/, plus a quick view of
worktrees and recent commits. Run with:

    python3 researchloop-dev/agent-runner/dashboard.py [PORT]

Opens at http://localhost:7777 by default. Localhost-only, no auth.
"""
import fcntl
import http.server
import json
import os
import pty
import re
import secrets
import select
import shlex
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = REPO_ROOT / "researchloop-dev" / "agent-runner" / "state"
WORKTREES_DIR = REPO_ROOT / ".agent-worktrees"
PROMPTS_DIR = REPO_ROOT / "researchloop-dev" / "agent-runner" / "prompts"
USER_SHELL = os.environ.get("SHELL", "/bin/bash")

# Defaults for the per-issue interactive launcher. The "yolo" flag bypasses
# codex's approval prompts and sandbox — only safe because each agent runs in
# its own disposable worktree.
CODEX_BIN   = os.environ.get("CODEX_BIN", "codex")
CODEX_MODEL = os.environ.get("CODEX_MODEL", "gpt-5.4-mini")
CODEX_YOLO  = os.environ.get("CODEX_YOLO", "--dangerously-bypass-approvals-and-sandbox")

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
header button{background:#1f6feb;color:#fff;border:1px solid #1f6feb;border-radius:5px;padding:5px 12px;cursor:pointer;font-size:12px;font-family:inherit;}
header button:hover{background:#2f7fff;}
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
.worktree button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;font-family:inherit;margin-top:4px;}
.worktree button:hover{background:#1f6feb;color:#fff;border-color:#1f6feb;}
@keyframes pulse{50%{opacity:0.4;}}
.pty{padding:8px 18px;font-size:12px;border-bottom:1px solid #21262d;cursor:pointer;border-left:3px solid transparent;}
.pty:hover{background:#161b22;}
.pty.active{background:#161b22;border-left-color:#3fb950;}
.pty .meta{font-size:10px;color:#6e7681;margin-top:2px;word-break:break-all;}
.filters{padding:0 18px 8px;display:flex;gap:4px;flex-wrap:wrap;}
.filters button{background:#0d1117;color:#8b949e;border:1px solid #30363d;border-radius:12px;padding:3px 10px;cursor:pointer;font-size:11px;font-family:inherit;}
.filters button:hover{color:#c9d1d9;}
.filters button.on{background:#1f6feb;color:#fff;border-color:#1f6feb;}
.issue,.pr{padding:10px 18px;border-bottom:1px solid #21262d;font-size:12px;}
.issue .num,.pr .num{color:#8b949e;}
.issue .ttl,.pr .ttl{color:#c9d1d9;margin-bottom:6px;display:flex;align-items:baseline;gap:6px;}
.issue .ttl .caret{cursor:pointer;color:#6e7681;font-size:10px;width:10px;flex-shrink:0;user-select:none;}
.issue .ttl .caret:hover{color:#58a6ff;}
.issue .ttl .title-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.issue .ttl .ext{color:#6e7681;text-decoration:none;font-size:11px;opacity:0;transition:opacity 0.1s;flex-shrink:0;}
.issue:hover .ttl .ext{opacity:1;}
.issue .ttl .ext:hover{color:#58a6ff;}
.issue.open .ttl .title-text{white-space:normal;}
.issue .body{display:none;margin:6px 0 8px 16px;padding:8px 10px;background:#0d1117;border-left:2px solid #30363d;border-radius:0 3px 3px 0;font-size:11px;color:#c9d1d9;line-height:1.5;max-height:340px;overflow-y:auto;}
.issue.open .body{display:block;}
.issue .body pre{background:#161b22;padding:6px 8px;border-radius:3px;overflow-x:auto;font-size:10px;margin:4px 0;}
.issue .body code{background:#161b22;padding:0 4px;border-radius:2px;font-size:10px;}
.issue .body pre code{background:transparent;padding:0;}
.issue .body b{color:#58a6ff;display:block;margin-top:6px;}
.issue .body a{color:#58a6ff;}
.issue .body-loading,.issue .body-err{color:#6e7681;font-style:italic;padding:4px 0;}
.issue .body-err{color:#ff7b72;}
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
.pr button.review.done{background:#161b22;color:#6e7681;border-color:#21262d;}
.pr button.review.done:hover:not(:disabled){background:#21262d;color:#8b949e;border-color:#30363d;}
.pr button.merge.interactive{background:#1a3a2a;color:#56d364;border-color:#234a32;}
.pr button.merge.interactive:hover:not(:disabled){background:#0e6e3e;color:#fff;border-color:#0e6e3e;}
.pr a.reviewed{display:inline-block;margin-left:6px;padding:0 5px;border-radius:8px;background:#21262d;color:#7d8590;font-size:10px;text-decoration:none;border:1px solid #30363d;vertical-align:1px;}
.pr a.reviewed:hover{background:#2d333b;color:#c9d1d9;border-color:#58a6ff;}
aside h2 .hdr-btn{float:right;background:#0d1117;color:#8b949e;border:1px solid #30363d;border-radius:4px;padding:2px 8px;font-size:11px;font-family:inherit;cursor:pointer;margin-left:6px;font-weight:normal;}
aside h2 .hdr-btn:hover{color:#c9d1d9;border-color:#58a6ff;}
#pr-bar{padding:6px 12px;background:#0d1117;border-bottom:1px solid #21262d;font-size:11px;color:#8b949e;display:none;}
#pr-bar.show{display:block;}
#pr-bar a{color:#58a6ff;text-decoration:none;}
#pr-bar a:hover{text-decoration:underline;}
#pr-bar .sep{color:#30363d;margin:0 8px;}
#pr-bar .verdict-link{color:#56d364;}
#toast{position:fixed;bottom:20px;right:20px;background:#161b22;color:#c9d1d9;padding:10px 16px;border-radius:6px;border:1px solid #30363d;font-size:12px;display:none;z-index:100;}
#toast.err{border-color:#f85149;color:#ff7b72;}
#toast.ok{border-color:#3fb950;color:#56d364;}
#tip{position:fixed;background:#1f2428;color:#f0f6fc;padding:6px 10px;border-radius:5px;font-size:11px;font-family:ui-monospace,Menlo,Consolas,monospace;border:1px solid #30363d;pointer-events:none;display:none;z-index:10000;max-width:320px;white-space:normal;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.12s ease;}
#tip.show{opacity:1;}
</style></head>
<body>
<header>
  <h1>autoresearch-ai · agent-runner</h1>
  <button id="newShellBtn" title="Open an interactive shell in the repo root">+ new shell</button>
  <span id="lastUpdate">—</span>
  <span>Live terminals stream via long-poll · Log files refresh every 800ms when followed</span>
</header>
<main>
  <aside>
    <h2>Issues <span class="count" id="issueCount"></span>
      <button class="hdr-btn" onclick="proposeIssue()" title="Open an interactive codex --yolo session that drafts a new agent-feature issue body (Researcher line, Demo, Acceptance, Anti-features, Files). When codex exits, the shell stays open with a ready-to-run gh issue create command.">📝 propose</button>
    </h2>
    <div class="filters" id="filters">
      <button data-f="all" class="on" title="All open issues, including validated, in-progress, and parked ones.">all</button>
      <button data-f="claim-next" title="Issues open for an agent to grab. The orchestrator picks the lowest-numbered one by default.">claim-next</button>
      <button data-f="good first issue" title="Triaged as approachable for a new contributor or new agent.">good first</button>
      <button data-f="agent-friendly" title="Self-contained scope that fits the agent contract (single file, demo, anti-features).">agent</button>
      <button data-f="needs-validation" title="Speculative — waiting on a real user to confirm before opening for agents.">parked</button>
    </div>
    <div id="issues"><div class="empty">loading…</div></div>
    <h2>Open PRs <span class="count" id="prCount"></span></h2>
    <div id="prs"><div class="empty">loading…</div></div>
    <h2>Live terminals</h2>
    <div id="ptys"><div class="empty">no terminals · click + new shell</div></div>
    <h2>Active worktrees</h2>
    <div id="worktrees"><div class="empty">none</div></div>
    <h2>State files
      <button class="hdr-btn" onclick="cleanupState(true)" title="Dry-run: list state files older than 7 days that the cleanup would remove. Nothing is deleted.">🧹 audit</button>
      <button class="hdr-btn" onclick="cleanupState(false)" title="Delete state files older than 7 days (implementer/orchestrator logs, prompts, diffs, drafts). Worktrees and the .gitignore are never touched.">🧹 prune</button>
    </h2>
    <div id="files"><div class="empty">scanning…</div></div>
  </aside>
  <div id="toast"></div>
  <div id="tip"></div>
  <section>
    <h2><span id="title">pick a file or open a shell →</span>
      <span class="ctl">
        <button id="followBtn" title="Jump to the bottom of the buffer (xterm auto-tails once you're there)">↓ bottom</button>
        <button id="replayBtn" title="Re-play a completed log from byte zero with a typing animation (file mode only).">replay</button>
        <button id="clearBtn" title="Clear the terminal pane. Doesn't kill the session; output keeps streaming.">clear</button>
        <button id="killBtn" title="Kill the current PTY session">close ✕</button>
      </span>
    </h2>
    <div id="pr-bar"></div>
    <div id="term-wrap"><div id="hint">🖥️ <b>codex --yolo</b> next to an issue: preps the worktree and launches codex (gpt-5.4-mini) interactively with the issue's prompt already loaded. You can type at it like a real terminal.<br>🔍 <b>codex --yolo review</b> next to a PR: same interactive mode, with the PR diff + linked issue body pre-loaded as the review prompt.<br>📝 <b>propose</b> in the Issues header: drafts a new agent-feature issue body interactively with codex.<br>💻 <b>+ new shell</b> in header: plain interactive shell in the repo root.<br>📁 Click any state file on the left to tail an agent's log.<br>🧹 <b>State files</b> header: <i>audit</i> shows what's old, <i>prune</i> deletes it.</div></div>
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
  convertEol: false, scrollback: 50000, cursorBlink: true
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.loadAddon(new WebLinksAddon.WebLinksAddon());

let termAttached = false;
let inputHandler = null;
function attachTerm() {
  if (termAttached) return;
  const wrap = document.getElementById('term-wrap');
  wrap.innerHTML = '';
  term.open(wrap);
  fitAddon.fit();
  termAttached = true;
  window.addEventListener('resize', () => { try { fitAddon.fit(); sendResize(); } catch(e){} });
  // One single onData handler; it dispatches based on the current mode.
  term.onData(data => { if (inputHandler) inputHandler(data); });
}

// Current view state. Either {kind:'file', name} or {kind:'pty', sid, label}.
let view = null;
let cursor = 0;        // bytes already written / offset acknowledged
let follow = true;
let pollTimer = null;
let replayMode = false;
let ptyAbort = null;
let ptyStreamGen = 0;  // bumped on every selectPty to abort stale loops

function sendResize() {
  if (!view || view.kind !== 'pty' || !termAttached) return;
  const rows = term.rows, cols = term.cols;
  fetch('/api/pty/resize', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({sid: view.sid, rows, cols})}).catch(()=>{});
}

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
        const cls = (view && view.kind === 'file' && view.name === f.name) ? 'file active' : 'file';
        const safeName = f.name.replace(/'/g, "\\'");
        return `<div class="${cls}" data-name="${f.name}" title="Tail this log file (${fmtSize(f.size)}). Read-only — keystrokes are dropped." onclick="selectFile('${safeName}')">${f.name}<span class="meta">${fmtSize(f.size)} · ${fmtTime(f.mtime)}</span></div>`;
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
      el.innerHTML = data.worktrees.map(w => {
        const safe = w.name.replace(/'/g, "\\'");
        return `<div class="worktree ${runningSet.has(w.name) ? 'live' : ''}"><div class="name">${w.name}</div><div class="commits">${w.commits || 'no commits yet'} · ${w.dirty ? 'uncommitted edits' : 'clean'}${runningSet.has(w.name) ? ' · agent active' : ''}</div><button onclick="openWorktreeShell('${safe}')" title="Open an interactive shell in this worktree">🖥️ open shell</button></div>`;
      }).join('');
    }
  } catch(e) { console.error(e); }
}

let issueFilter = 'all';
let allIssues = [];
const _issueBodyCache = new Map();   // num -> body markdown

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
      <div class="issue ${it.in_progress ? 'busy' : ''} ${it.parked ? 'parked' : ''}" data-num="${it.number}">
        <div class="ttl">
          <span class="caret" data-action="toggle" title="Show issue body (Researcher / Demo / Acceptance / Anti-features / Files)">▸</span>
          <span class="num">#${it.number}</span>
          <span class="title-text" title="${escapeHtml(it.title)}">${escapeHtml(it.title)}</span>
          <a class="ext" href="${escapeHtml(it.url)}" target="_blank" title="Open issue on GitHub">↗</a>
        </div>
        ${labelChips ? `<div class="lbls">${labelChips}</div>` : ''}
        <div class="body" id="ibody-${it.number}"></div>
        <div class="row">
          <button onclick="launchIssueShell(${it.number})" title="Prep worktree + run codex --yolo (gpt-5.4-mini) interactively with this issue's prompt">🖥️ codex --yolo</button>
          <button onclick="launchIssue(${it.number}, 'watch')" ${it.in_progress ? 'disabled' : ''} title="Spawn orchestrator (headless codex exec); auto-switch terminal to log">▶ watch</button>
          <button class="headless" onclick="launchIssue(${it.number}, 'headless')" ${it.in_progress ? 'disabled' : ''} title="Spawn orchestrator in background; don't switch view">⌁ bg</button>
        </div>
      </div>
    `;
  }).join('');
}

// Event delegation for issue caret clicks — toggles the body panel.
document.getElementById('issues').addEventListener('click', async (e) => {
  const c = e.target.closest('.caret');
  if (!c) return;
  const row = c.closest('.issue');
  if (!row) return;
  const num = row.dataset.num;
  const body = document.getElementById('ibody-' + num);
  const open = row.classList.toggle('open');
  c.textContent = open ? '▾' : '▸';
  if (!open) { body.innerHTML = ''; return; }
  if (_issueBodyCache.has(num)) {
    body.innerHTML = renderIssueBody(_issueBodyCache.get(num));
    return;
  }
  body.innerHTML = '<div class="body-loading">loading…</div>';
  try {
    const r = await fetch('/api/issue?num=' + num);
    const d = await r.json();
    if (d.error) { body.innerHTML = `<div class="body-err">${escapeHtml(d.error)}</div>`; return; }
    _issueBodyCache.set(num, d.body || '_(empty body)_');
    body.innerHTML = renderIssueBody(d.body || '_(empty body)_');
  } catch(err) {
    body.innerHTML = `<div class="body-err">fetch failed: ${escapeHtml(String(err))}</div>`;
  }
});

// Tiny markdown — only what we need for issue bodies: headings, code blocks,
// inline code, links, line breaks. Anything else falls through as plain text.
function renderIssueBody(md) {
  let html = escapeHtml(md);
  // ```fenced code```
  html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  // ### / ## / # headings
  html = html.replace(/^###\s+(.+)$/gm, '<b>$1</b>');
  html = html.replace(/^##\s+(.+)$/gm, '<b>$1</b>');
  html = html.replace(/^#\s+(.+)$/gm, '<b>$1</b>');
  // [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // `inline code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // remaining newlines
  html = html.replace(/\n/g, '<br>');
  return html;
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
      const reviewed = !!pr.reviewed_by_codex;
      const reviewUrl = pr.review_url || pr.url + '#issuecomment';
      const reviewBadge = reviewed
        ? `<a href="${escapeHtml(reviewUrl)}" target="_blank" class="b reviewed" title="codex already posted a verdict on this PR — click to open">codex ✓</a>`
        : '';
      const reviewTitle = reviewed
        ? `codex already reviewed this PR — re-run only if the diff changed materially. Click "codex ✓" badge to read the verdict.`
        : `Run codex --yolo (gpt-5.4-mini) interactively over the PR diff + issue body. Codex writes its verdict to a file; after it exits, the wrapper auto-posts to the PR and captures the comment URL.`;
      return `
        <div class="pr">
          <div class="ttl"><span class="num">#${pr.number}</span> ${escapeHtml(pr.title)}${reviewBadge}</div>
          <div class="badges">${draftBadge}${decBadge}${ciBadge}</div>
          <div class="row">
            <button class="review${reviewed ? ' done' : ''}" onclick="reviewPR(${pr.number})" title="${escapeHtml(reviewTitle)}">${reviewed ? '🔁 re-review' : '🔍 codex --yolo review'}</button>
            <button class="merge interactive" onclick="mergeInteractive(${pr.number})" title="Open an interactive codex --yolo session that merges PR #${pr.number} into main. If the squash-merge fails on conflicts, codex rebases onto main, resolves conflicts (asking you if uncertain), pushes, and retries. Push notification fires when it needs you.">🟢 codex --yolo merge</button>
            <button class="merge" onclick="mergePR(${pr.number})" ${mergeDisabled ? 'disabled' : ''} title="${mergeDisabled ? 'PR is draft / not mergeable / changes requested' : 'gh pr merge --squash --delete-branch — no agent, just the gh call'}">✓ quick squash-merge</button>
            <button onclick="viewPRDiff(${pr.number})" title="Show the diff in the terminal pane">view diff</button>
          </div>
        </div>
      `;
    }).join('');
  } catch(e) { console.error(e); }
}

// Per-session PR metadata (set when the PTY is one of pr-review/merge-pr).
const sessionPRInfo = new Map();  // sid -> {pr, url, review_url_file, kind}

async function reviewPR(num) {
  requestNotifPermission();
  showToast(`preparing review for PR #${num}…`, '');
  try {
    const r = await fetch('/api/pty/new', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind:'pr-review', pr: num, rows: term.rows, cols: term.cols})
    });
    const data = await r.json();
    if (data.error) { showToast(`error: ${data.error}`, 'err'); return; }
    sessionPRInfo.set(data.sid, {pr: num, url: data.pr_url, review_url_file: data.review_url_file, kind: 'review'});
    showToast(`PR #${num} → codex --yolo (${data.model || 'gpt-5.4-mini'}) running. Verdict will auto-post on exit.`, 'ok');
    await listPtys();
    selectPty(data.sid, data.label || `review PR #${num}`);
  } catch(e) { showToast(`review failed: ${e}`, 'err'); }
}

async function mergeInteractive(num) {
  requestNotifPermission();
  if (!confirm(`Launch codex --yolo to merge PR #${num} into main? It will try gh pr merge first; on conflicts it rebases, asks you on non-mechanical conflicts, and retries.`)) return;
  showToast(`spawning codex --yolo merger for PR #${num}…`, '');
  try {
    const r = await fetch('/api/pty/new', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind:'merge-pr', pr: num, rows: term.rows, cols: term.cols})
    });
    const data = await r.json();
    if (data.error) { showToast(`error: ${data.error}`, 'err'); return; }
    sessionPRInfo.set(data.sid, {pr: num, url: data.pr_url, kind: 'merge'});
    showToast(`PR #${num} → codex --yolo merger running. Notifications enabled for prompts.`, 'ok');
    await listPtys();
    selectPty(data.sid, data.label || `merge PR #${num}`);
  } catch(e) { showToast(`merge launch failed: ${e}`, 'err'); }
}

async function mergePR(num) {
  if (!confirm(`Squash-merge PR #${num} into main and delete the branch? No agent — just gh pr merge. This is final.`)) return;
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

// ---------- browser push notifications ----------
let _notifAsked = false;
function requestNotifPermission() {
  if (_notifAsked || !('Notification' in window)) return;
  _notifAsked = true;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(()=>{});
  }
}
function fireNotif(title, body, onclick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {body, tag: title, renotify: false});
    if (onclick) n.onclick = () => { window.focus(); onclick(); n.close(); };
    setTimeout(() => n.close(), 12000);
  } catch(e) { console.warn('notif failed', e); }
}

// ---------- PR bar (clickable header above terminal) ----------
function renderPRBar(sid) {
  const bar = document.getElementById('pr-bar');
  const info = sessionPRInfo.get(sid);
  if (!info || !info.pr) { bar.className = ''; bar.innerHTML = ''; return; }
  const kindLabel = info.kind === 'review' ? 'reviewing' : (info.kind === 'merge' ? 'merging' : '');
  const prLink = info.url
    ? `<a href="${escapeHtml(info.url)}" target="_blank">PR #${info.pr} ↗</a>`
    : `PR #${info.pr}`;
  let verdictLink = '';
  if (info.review_url_file) {
    // Try to read the saved verdict URL — written only after codex exits + we posted.
    fetch('/api/file?name=' + encodeURIComponent('review-' + info.pr + '.url'))
      .then(r => r.ok ? r.text() : '')
      .then(txt => {
        const url = (txt || '').trim();
        if (url && /^https?:/.test(url)) {
          const verdictEl = document.getElementById('pr-bar-verdict');
          if (verdictEl) verdictEl.innerHTML = `<span class="sep">·</span><a class="verdict-link" href="${escapeHtml(url)}" target="_blank">verdict ↗</a>`;
        }
      }).catch(()=>{});
    verdictLink = `<span id="pr-bar-verdict"></span>`;
  }
  bar.className = 'show';
  bar.innerHTML = `<b>${kindLabel}</b> ${prLink}<span class="sep">·</span>codex --yolo${verdictLink}`;
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

function stopStreams() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  ptyStreamGen++;        // invalidate any in-flight pty long-poll loop
  if (ptyAbort) { try { ptyAbort.abort(); } catch(e){} ptyAbort = null; }
}

function selectFile(name) {
  stopStreams();
  view = {kind: 'file', name};
  cursor = 0;
  replayMode = false;
  inputHandler = null;        // read-only — drop keystrokes
  document.getElementById('title').textContent = '📄 ' + name;
  document.querySelectorAll('aside .file').forEach(el => el.classList.toggle('active', el.dataset.name === name));
  document.querySelectorAll('aside .pty').forEach(el => el.classList.remove('active'));
  document.getElementById('pr-bar').className = '';
  attachTerm();
  term.reset();
  pollOnce();
  pollTimer = setInterval(pollOnce, 800);
}

function selectPty(sid, label) {
  stopStreams();
  view = {kind: 'pty', sid, label};
  cursor = 0;
  replayMode = false;
  // PTY mode — keystrokes go to backend.
  inputHandler = (data) => {
    fetch('/api/pty/input', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({sid, data})}).catch(()=>{});
  };
  document.getElementById('title').textContent = '💻 ' + (label || sid);
  document.querySelectorAll('aside .file').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('aside .pty').forEach(el => el.classList.toggle('active', el.dataset.sid === sid));
  renderPRBar(sid);
  attachTerm();
  term.reset();
  // Defer the resize until after attach so xterm rows/cols are populated.
  setTimeout(sendResize, 50);
  streamPty();
}

async function streamPty() {
  const gen = ++ptyStreamGen;
  const sid = view.sid;
  // Long-poll loop, ~15s timeout per request server-side.
  while (gen === ptyStreamGen && view && view.kind === 'pty' && view.sid === sid) {
    try {
      ptyAbort = new AbortController();
      const r = await fetch('/api/pty/stream?sid=' + encodeURIComponent(sid) + '&offset=' + cursor + '&timeout=15',
                            {signal: ptyAbort.signal});
      if (!r.ok) {
        if (r.status === 404) { showToast('session ended', 'err'); return; }
        await new Promise(rs => setTimeout(rs, 1000));
        continue;
      }
      const reset = r.headers.get('X-Reset') === '1';
      const newOffset = parseInt(r.headers.get('X-Offset') || '0', 10);
      const alive = r.headers.get('X-Alive') === '1';
      const buf = await r.arrayBuffer();
      if (reset) {
        term.reset();
        term.write('\r\n[reconnect: dropped earlier output]\r\n');
      }
      if (buf.byteLength > 0) {
        // xterm.write accepts Uint8Array directly and decodes UTF-8, and
        // handles scroll behavior natively: stays pinned to the bottom when
        // the user is at the bottom, preserves position when they've scrolled
        // up. Don't call scrollToBottom() — that's what was overriding their
        // scroll. The "↓ bottom" button in the header is the manual catch-up.
        term.write(new Uint8Array(buf));
      }
      cursor = newOffset;
      if (!alive) {
        term.write('\r\n\x1b[33m[session ended]\x1b[0m\r\n');
        listPtys();
        return;
      }
    } catch(e) {
      if (e.name === 'AbortError') return;
      await new Promise(rs => setTimeout(rs, 800));
    }
  }
}

async function pollOnce() {
  if (!view || view.kind !== 'file' || replayMode) return;
  try {
    const r = await fetch('/api/file?name=' + encodeURIComponent(view.name) + '&offset=' + cursor);
    const text = await r.text();
    if (text.length > 0) {
      term.write(text);
      cursor += new TextEncoder().encode(text).length;
      // No forced scroll — xterm preserves the user's scroll position if they've scrolled up.
    }
  } catch(e) { console.error(e); }
}

async function replay() {
  if (!view || view.kind !== 'file') { showToast('replay only works for log files', 'err'); return; }
  if (pollTimer) clearInterval(pollTimer);
  replayMode = true;
  term.reset();
  cursor = 0;
  document.getElementById('replayBtn').classList.add('on');
  try {
    const r = await fetch('/api/file?name=' + encodeURIComponent(view.name));
    const text = await r.text();
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

// "follow" is now a one-shot jump-to-bottom. xterm auto-tails when the viewport
// is already at the bottom, and respects the user's position when they scroll
// up, so we just need a way to "snap back" when they want to catch up.
document.getElementById('followBtn').onclick = () => { if (termAttached) term.scrollToBottom(); };
document.getElementById('replayBtn').onclick = replay;
document.getElementById('clearBtn').onclick = () => { if (termAttached) { term.reset(); cursor = view && view.kind === 'pty' ? cursor : 0; } };
document.getElementById('killBtn').onclick = async () => {
  if (!view || view.kind !== 'pty') { showToast('not a pty session', 'err'); return; }
  if (!confirm('Close this terminal session? Any running command will be killed.')) return;
  await fetch('/api/pty/close', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({sid: view.sid})});
  listPtys();
};

// Filter chip handlers
document.getElementById('filters').addEventListener('click', e => {
  if (e.target.tagName !== 'BUTTON') return;
  issueFilter = e.target.dataset.f;
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === issueFilter));
  renderIssues();
});

const _prevPtyAlive = new Map();  // sid -> bool, used to detect alive→dead transitions
async function listPtys() {
  try {
    const r = await fetch('/api/pty/list');
    const data = await r.json();
    const el = document.getElementById('ptys');
    const sessions = data.sessions || [];
    // Detect alive→dead transitions and fire notifications, then refresh PRs
    // so the reviewed badge appears if the session just posted a verdict.
    let didTransition = false;
    for (const s of sessions) {
      const prev = _prevPtyAlive.get(s.sid);
      if (prev === true && !s.alive) {
        didTransition = true;
        const info = sessionPRInfo.get(s.sid);
        const title = info && info.pr
          ? `codex ${info.kind} finished · PR #${info.pr}`
          : `codex session finished`;
        const body = s.label || s.sid;
        fireNotif(title, body, () => selectPty(s.sid, s.label));
      }
      _prevPtyAlive.set(s.sid, s.alive);
    }
    if (didTransition) { listPRs(); listIssues(); }
    if (!sessions.length) { el.innerHTML = '<div class="empty">no terminals · click + new shell</div>'; return; }
    el.innerHTML = sessions.map(s => {
      const cwd = s.cwd.replace(/^.*?\.agent-worktrees\//, '.agent-worktrees/').replace(/^.*?\/autoresearch-ai\/(?:\.claude\/worktrees\/[^/]+\/)?/, '');
      const label = s.label || s.sid;
      const dot = s.alive ? '<span style="color:#3fb950;">●</span>' : '<span style="color:#6e7681;">○</span>';
      const cls = (view && view.kind === 'pty' && view.sid === s.sid) ? 'pty active' : 'pty';
      // No inline onclick — handled by event delegation. data-* attrs are
      // HTML-escaped, so labels containing quotes / unicode no longer break
      // the attribute parsing (the previous bug: JSON.stringify(label) injected
      // raw " into a double-quoted attr, closing it early).
      const tip = s.alive
        ? `Attach the terminal pane to this live session. PID running in ${cwd}.`
        : `Session ended. Click to view its scrollback (no new input possible).`;
      return `<div class="${cls}" data-sid="${escapeHtml(s.sid)}" data-label="${escapeHtml(label)}" title="${escapeHtml(tip)}">${dot} ${escapeHtml(label)}<div class="meta">${escapeHtml(cwd)}</div></div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

// Event delegation for PTY rows — survives re-renders by listPtys().
document.getElementById('ptys').addEventListener('click', (e) => {
  const row = e.target.closest('.pty');
  if (!row) return;
  selectPty(row.dataset.sid, row.dataset.label);
});

async function newShell(cwd, label) {
  showToast('spawning shell…', '');
  try {
    const r = await fetch('/api/pty/new', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({kind:'shell', cwd, rows: term.rows, cols: term.cols})});
    const data = await r.json();
    if (data.error) { showToast('error: ' + data.error, 'err'); return; }
    showToast('shell open ✓', 'ok');
    await listPtys();
    selectPty(data.sid, data.label || label);
  } catch(e) { showToast('shell failed: ' + e, 'err'); }
}

async function openWorktreeShell(wtName) {
  // Server resolves this relative path against REPO_ROOT.
  await newShell('.agent-worktrees/' + wtName, 'shell · ' + wtName);
}

async function launchIssueShell(num) {
  showToast(`preparing worktree for #${num} + launching codex --yolo…`, '');
  try {
    const r = await fetch('/api/pty/new', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({kind:'issue-shell', issue: num, rows: term.rows, cols: term.cols})});
    const data = await r.json();
    if (data.error) { showToast('error: ' + data.error, 'err'); return; }
    showToast(`#${num} → codex --yolo (${data.model || 'gpt-5.4-mini'}) running interactively`, 'ok');
    await listPtys();
    selectPty(data.sid, data.label || `#${num}`);
    listIssues(); listWorktrees();
  } catch(e) { showToast('launch failed: ' + e, 'err'); }
}

async function proposeIssue() {
  const hint = (prompt('rough slug for the new issue (lowercase, dashes — codex will write the real title). Leave blank for a timestamped draft.', '') || '').trim();
  if (hint === null) return;
  showToast(`spawning codex --yolo to draft a new issue…`, '');
  try {
    const r = await fetch('/api/pty/new', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({kind:'propose-issue', slug: hint, rows: term.rows, cols: term.cols})});
    const data = await r.json();
    if (data.error) { showToast('error: ' + data.error, 'err'); return; }
    showToast(`propose · ${data.slug} → codex --yolo running. Draft: ${data.draft_file}`, 'ok');
    await listPtys();
    selectPty(data.sid, data.label || `propose · ${data.slug}`);
    listFiles();
  } catch(e) { showToast('propose failed: ' + e, 'err'); }
}

async function cleanupState(dryRun) {
  const days = parseInt(prompt(dryRun ? 'audit state files older than how many days?' : 'PRUNE state files older than how many days? (deletes implementer/orchestrator logs, prompts, diffs, drafts)', '7'), 10);
  if (!Number.isFinite(days) || days < 0) return;
  if (!dryRun && !confirm(`Delete state files older than ${days} day(s)? Worktrees and .gitignore are untouched.`)) return;
  try {
    const r = await fetch('/api/state/cleanup', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({stale_days: days, dry_run: !!dryRun})});
    const d = await r.json();
    if (d.error) { showToast('error: ' + d.error, 'err'); return; }
    const mb = (d.freed_bytes / 1048576).toFixed(2);
    const verb = d.dry_run ? 'would free' : 'freed';
    showToast(`${verb} ${mb} MB · ${d.removed.length} file(s) ${d.dry_run ? 'flagged' : 'removed'} · ${d.kept_count} kept`, 'ok');
    if (d.removed.length) console.table(d.removed);
    listFiles();
  } catch(e) { showToast('cleanup failed: ' + e, 'err'); }
}

document.getElementById('newShellBtn').onclick = () => newShell(null, 'shell · repo root');

// ---------- styled tooltip controller ----------
// One floating element, repositioned on hover. Reads from `title` (so every
// existing button/row gets a tooltip for free) and stashes the original onto
// `data-tip` to suppress the slow ugly native tooltip while keeping the value
// re-attachable on mouseleave (so screen readers + DevTools still see it).
const tipEl = document.getElementById('tip');
let tipTarget = null;

function showTip(target, text) {
  if (!text) { hideTip(); return; }
  tipTarget = target;
  tipEl.textContent = text;
  tipEl.style.display = 'block';
  // Force layout then position; default above the element, shifted left if it'd clip.
  const rect = target.getBoundingClientRect();
  const tipRect = tipEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top  = rect.top - tipRect.height - 8;
  // Flip below if it'd go above the viewport.
  if (top < 4) top = rect.bottom + 8;
  // Clamp horizontally.
  left = Math.max(6, Math.min(left, window.innerWidth - tipRect.width - 6));
  tipEl.style.left = left + 'px';
  tipEl.style.top  = top  + 'px';
  requestAnimationFrame(() => tipEl.classList.add('show'));
}
function hideTip() {
  tipEl.classList.remove('show');
  tipEl.style.display = 'none';
  if (tipTarget && tipTarget.dataset.tip != null) {
    tipTarget.setAttribute('title', tipTarget.dataset.tip);
    delete tipTarget.dataset.tip;
  }
  tipTarget = null;
}
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[title], [data-tip]');
  if (!t || t === tipTarget) return;
  // Pull title once and stash it so the native tooltip doesn't appear after a delay.
  let text = t.getAttribute('title');
  if (text) {
    t.dataset.tip = text;
    t.removeAttribute('title');
  } else {
    text = t.dataset.tip;
  }
  if (text) showTip(t, text);
});
document.addEventListener('mouseout', (e) => {
  if (!tipTarget) return;
  // Only hide when leaving the tipTarget entirely (not on transit between its children).
  if (!tipTarget.contains(e.relatedTarget)) hideTip();
});
window.addEventListener('scroll', hideTip, true);
window.addEventListener('blur', hideTip);

// Browsers gate Notifications behind a user gesture — ask on the first click.
window.addEventListener('click', () => requestNotifPermission(), {once: true, capture: true});

listFiles(); listWorktrees(); listIssues(); listPRs(); listPtys();
setInterval(listFiles, 5000);
setInterval(listWorktrees, 4000);
setInterval(listIssues, 20000);
setInterval(listPRs, 15000);
setInterval(listPtys, 3000);
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


# ---------- PTY session manager ----------
# Spawns child processes under a real pseudo-terminal so the browser xterm can
# write keystrokes back to them. Output is buffered in memory; clients long-poll
# /api/pty/stream with a byte offset.

_PTY_SESSIONS = {}   # sid -> session dict
_PTY_LOCK = threading.Lock()
_PTY_BUF_CAP = 4 * 1024 * 1024  # 4MB per session; older bytes get trimmed


def _set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def spawn_pty(argv, cwd=None, env_extra=None, label="", rows=30, cols=120):
    """Fork a child under a PTY, return the session dict. Output is collected
    in sess['buf']; sess['drop'] counts how many bytes were trimmed from the
    head so clients can detect missed data and reset."""
    if isinstance(argv, str):
        argv = shlex.split(argv)
    sid = secrets.token_hex(6)
    pid, fd = pty.fork()
    if pid == 0:
        try:
            if cwd:
                os.chdir(cwd)
            env = os.environ.copy()
            env.setdefault("TERM", "xterm-256color")
            env.setdefault("COLORTERM", "truecolor")
            if env_extra:
                env.update(env_extra)
            for k, v in env.items():
                os.environ[k] = v
            os.execvp(argv[0], argv)
        except Exception as e:
            os.write(2, f"\r\nexec failed: {e}\r\n".encode())
            os._exit(127)
    _set_winsize(fd, rows, cols)
    sess = {
        "sid": sid,
        "fd": fd,
        "pid": pid,
        "argv": argv,
        "cwd": cwd or os.getcwd(),
        "label": label or " ".join(argv),
        "started": time.time(),
        "rows": rows, "cols": cols,
        "buf": bytearray(),
        "drop": 0,                       # bytes trimmed off the front
        "cond": threading.Condition(),
        "alive": True,
        "exit_status": None,
    }
    with _PTY_LOCK:
        _PTY_SESSIONS[sid] = sess
    threading.Thread(target=_pty_reader, args=(sid,), daemon=True).start()
    threading.Thread(target=_pty_waiter, args=(sid,), daemon=True).start()
    return sess


def _pty_reader(sid):
    sess = _PTY_SESSIONS.get(sid)
    if not sess:
        return
    fd = sess["fd"]
    try:
        while True:
            try:
                r, _, _ = select.select([fd], [], [], 1.0)
            except (ValueError, OSError):
                break
            if fd in r:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                with sess["cond"]:
                    sess["buf"].extend(chunk)
                    # Ring-buffer cap: trim oldest bytes if we exceed cap.
                    excess = len(sess["buf"]) - _PTY_BUF_CAP
                    if excess > 0:
                        del sess["buf"][:excess]
                        sess["drop"] += excess
                    sess["cond"].notify_all()
            if not sess["alive"]:
                break
    finally:
        sess["alive"] = False
        with sess["cond"]:
            sess["cond"].notify_all()


def _pty_waiter(sid):
    sess = _PTY_SESSIONS.get(sid)
    if not sess:
        return
    try:
        _, status = os.waitpid(sess["pid"], 0)
        sess["exit_status"] = status
    except OSError:
        pass
    sess["alive"] = False
    try:
        os.close(sess["fd"])
    except OSError:
        pass
    with sess["cond"]:
        sess["cond"].notify_all()


def pty_write(sid, data: bytes) -> bool:
    sess = _PTY_SESSIONS.get(sid)
    if not sess or not sess["alive"]:
        return False
    try:
        os.write(sess["fd"], data)
        return True
    except OSError:
        return False


def pty_resize(sid, rows, cols):
    sess = _PTY_SESSIONS.get(sid)
    if not sess:
        return False
    _set_winsize(sess["fd"], rows, cols)
    sess["rows"], sess["cols"] = rows, cols
    return True


def pty_read(sid, offset, timeout=20):
    """Long-poll. Returns (data_bytes, new_logical_offset, alive, drop).

    The "logical offset" is total bytes ever written (including trimmed).
    drop is the count of bytes trimmed off the front so far; if the client's
    offset is below drop, the client must reset (buffer hole)."""
    sess = _PTY_SESSIONS.get(sid)
    if not sess:
        return None
    deadline = time.time() + timeout
    with sess["cond"]:
        while True:
            drop = sess["drop"]
            logical_len = drop + len(sess["buf"])
            if offset < drop:
                # Client missed bytes; send whatever's in the buffer and bump them up.
                data = bytes(sess["buf"])
                return data, logical_len, sess["alive"], drop, True
            buf_off = offset - drop
            if buf_off < len(sess["buf"]):
                data = bytes(sess["buf"][buf_off:])
                return data, logical_len, sess["alive"], drop, False
            if not sess["alive"]:
                return b"", logical_len, False, drop, False
            remaining = deadline - time.time()
            if remaining <= 0:
                return b"", logical_len, sess["alive"], drop, False
            sess["cond"].wait(timeout=min(remaining, 5))


def kill_pty(sid):
    sess = _PTY_SESSIONS.get(sid)
    if not sess:
        return False
    try:
        os.killpg(os.getpgid(sess["pid"]), signal.SIGHUP)
    except Exception:
        try:
            os.kill(sess["pid"], signal.SIGHUP)
        except OSError:
            pass
    sess["alive"] = False
    return True


def list_ptys():
    with _PTY_LOCK:
        return [
            {
                "sid": s["sid"],
                "label": s["label"],
                "cwd": s["cwd"],
                "alive": s["alive"],
                "started": s["started"],
                "rows": s["rows"], "cols": s["cols"],
            }
            for s in _PTY_SESSIONS.values()
        ]


def reap_dead_ptys(max_age_dead=600):
    """Drop dead sessions older than max_age_dead seconds so they stop cluttering the list."""
    now = time.time()
    with _PTY_LOCK:
        dead = [sid for sid, s in _PTY_SESSIONS.items()
                if not s["alive"] and (now - s["started"]) > max_age_dead]
        for sid in dead:
            _PTY_SESSIONS.pop(sid, None)


def _safe_relpath(p: Path) -> str:
    try:
        return str(p.relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def spawn_shell_session(cwd: Path, label: str = "", env_extra=None):
    """Spawn a login-ish interactive shell under a PTY."""
    if not cwd.exists():
        return {"error": f"cwd does not exist: {cwd}"}
    # -i ensures bash/zsh load rc files and run interactively.
    argv = [USER_SHELL, "-i"]
    sess = spawn_pty(argv, cwd=str(cwd), env_extra=env_extra,
                     label=label or f"shell · {_safe_relpath(cwd)}")
    return {"sid": sess["sid"], "label": sess["label"], "cwd": sess["cwd"]}


def prepare_issue_worktree(issue_num: int):
    """Run the orchestrator's worktree-setup steps up to (but not including)
    spawning the agent. Returns paths so the caller can drop a shell into the
    worktree with the prompt file ready to use.

    We do the minimum here: fetch the issue title, create the branch + worktree,
    relabel the issue, and materialise the prompt file. The full orchestrator
    pipeline (codex/claude exec, PR creation, reviewer) is skipped because the
    user is taking interactive control.
    """
    if not (1 <= issue_num <= 9999):
        return {"error": "bad issue number"}
    # Title → slug → branch name (mirror orchestrate.sh's slug_for_issue).
    try:
        title = subprocess.run(
            ["gh", "issue", "view", str(issue_num), "--json", "title", "--jq", ".title"],
            capture_output=True, text=True, timeout=15, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError as e:
        return {"error": f"gh issue view #{issue_num}: {e.stderr.strip() or e}"}
    if not title:
        return {"error": f"could not fetch title for issue #{issue_num}"}
    slug = re.sub(r"^\[(agent|goal)\][^a-zA-Z0-9]*", "", title)
    slug = re.sub(r"^G[0-9]+[^a-zA-Z0-9]*", "", slug)
    slug = re.sub(r"—.*$", "", slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")[:40]
    branch = f"agent/{issue_num}-{slug}"
    worktree = WORKTREES_DIR / f"{issue_num}-{slug}"

    if worktree.exists():
        # Already prepared; reuse.
        prompt_file = STATE_DIR / f"prompt-{issue_num}.md"
        return {
            "reused": True,
            "branch": branch,
            "worktree": str(worktree),
            "prompt_file": str(prompt_file) if prompt_file.exists() else None,
        }

    WORKTREES_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["git", "-C", str(REPO_ROOT), "worktree", "add", "-b", branch,
             str(worktree), "origin/main"],
            check=True, capture_output=True, text=True, timeout=30,
        )
    except subprocess.CalledProcessError as e:
        return {"error": f"git worktree add: {(e.stderr or e.stdout or '').strip()}"}

    # Relabel issue (best effort).
    try:
        subprocess.run(
            ["gh", "issue", "edit", str(issue_num),
             "--add-label", "in-progress", "--remove-label", "claim-next"],
            capture_output=True, text=True, timeout=15,
        )
    except Exception:
        pass

    # Materialise the prompt file via the same template the orchestrator uses.
    template_path = PROMPTS_DIR / "implement.md"
    body_path = STATE_DIR / f"issue-{issue_num}.body.md"
    prompt_path = STATE_DIR / f"prompt-{issue_num}.md"
    try:
        body = subprocess.run(
            ["gh", "issue", "view", str(issue_num), "--json", "body", "--jq", ".body"],
            capture_output=True, text=True, timeout=15, check=True,
        ).stdout
        body_path.write_text(body)
        if template_path.exists():
            tpl = template_path.read_text()
            prompt_path.write_text(
                tpl.replace("$ISSUE_BODY", body)
                   .replace("$BRANCH", branch)
                   .replace("$WORKTREE", str(worktree))
                   .replace("$ISSUE_NUMBER", str(issue_num))
            )
    except Exception as e:
        return {
            "warning": f"worktree created but prompt prep failed: {e}",
            "branch": branch, "worktree": str(worktree),
        }
    invalidate_caches()
    return {
        "created": True,
        "branch": branch,
        "worktree": str(worktree),
        "prompt_file": str(prompt_path),
    }


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
             "--json", "number,title,isDraft,headRefName,url,reviewDecision,mergeable,labels,statusCheckRollup,comments"],
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
            # Did codex already post a verdict? Look for our signature header.
            comments = pr.get("comments") or []
            pr["reviewed_by_codex"] = any(
                (c.get("body") or "").startswith("# Reviewer-agent verdict")
                for c in comments
            )
            # If we have a locally-saved comment URL, surface it.
            url_file = STATE_DIR / f"review-{pr['number']}.url"
            try:
                if url_file.exists():
                    pr["review_url"] = url_file.read_text().strip() or None
            except Exception:
                pass
            del pr["comments"]
        _PRS_CACHE.update({"ts": time.time(), "data": prs})
        return prs
    except Exception as e:
        return [{"error": str(e)}]


def invalidate_caches():
    _ISSUES_CACHE["ts"] = 0
    _PRS_CACHE["ts"] = 0


def prepare_pr_review(pr_num: int):
    """Build the reviewer prompt for a PR — mirrors orchestrate.sh's spawn_reviewer
    setup but inline so the dashboard can spawn the codex exec under a PTY
    instead of capturing its stdout to a file the user can't watch live."""
    if not (1 <= pr_num <= 9999):
        return {"error": "bad pr number"}
    # Pull PR body + diff, derive linked issue number from "Closes #N".
    try:
        body = subprocess.run(
            ["gh", "pr", "view", str(pr_num), "--json", "body,title", "--jq", ".body + \"\\n\" + .title"],
            capture_output=True, text=True, timeout=20, check=True,
        ).stdout
    except subprocess.CalledProcessError as e:
        return {"error": f"gh pr view #{pr_num}: {(e.stderr or '').strip() or e}"}
    # Try several link patterns; fall back to "no linked issue" if none stick.
    issue_num = None
    for pat in (r"(?:Closes|Fixes|Resolves|Implements)\s+#(\d+)",
                r"#(\d+)"):                                    # last resort
        m = re.search(pat, body, re.IGNORECASE)
        if m:
            issue_num = m.group(1)
            break
    try:
        diff = subprocess.run(
            ["gh", "pr", "diff", str(pr_num)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
    except subprocess.CalledProcessError as e:
        return {"error": f"gh pr diff #{pr_num}: {(e.stderr or '').strip() or e}"}
    ibody = ""
    if issue_num:
        try:
            ibody = subprocess.run(
                ["gh", "issue", "view", issue_num, "--json", "body", "--jq", ".body"],
                capture_output=True, text=True, timeout=20, check=True,
            ).stdout
        except subprocess.CalledProcessError:
            issue_num = None
            ibody = ""

    diff_file = STATE_DIR / f"pr-{pr_num}.diff"
    diff_file.write_text(diff)
    if issue_num:
        ibody_file = STATE_DIR / f"issue-{issue_num}.body.md"
        ibody_file.write_text(ibody)

    template_path = PROMPTS_DIR / "review.md"
    if not template_path.exists():
        return {"error": "prompts/review.md missing"}
    tpl = template_path.read_text()
    prompt = (
        tpl.replace("$PR_NUMBER", str(pr_num))
           .replace("$ISSUE_NUMBER", issue_num or "n/a")
           .replace("$DIFF", "(see PR diff section below)")
        + "\n\n## PR body\n\n" + body
        + ("\n\n## Issue body (#" + issue_num + ")\n\n" + ibody if issue_num
           else "\n\n## Issue body\n\n_no `Closes #N` link in PR body — review based on PR body + diff alone_")
        + "\n\n## PR diff\n\n```diff\n" + diff + "\n```\n"
    )
    prompt_file = STATE_DIR / f"review-prompt-{pr_num}.md"
    prompt_file.write_text(prompt)
    return {
        "pr": pr_num,
        "issue": int(issue_num) if issue_num else None,
        "prompt_file": str(prompt_file),
        "diff_size": len(diff),
    }


def prepare_merge(pr_num: int):
    """Render the merger prompt for a PR. Returns the prompt file path and
    the PR's head branch name so the wrapper can checkout if needed."""
    if not (1 <= pr_num <= 9999):
        return {"error": "bad pr number"}
    try:
        info = subprocess.run(
            ["gh", "pr", "view", str(pr_num), "--json",
             "headRefName,url,mergeable,isDraft,reviewDecision"],
            capture_output=True, text=True, timeout=15, check=True,
        ).stdout
        meta = json.loads(info)
    except subprocess.CalledProcessError as e:
        return {"error": f"gh pr view #{pr_num}: {(e.stderr or '').strip() or e}"}
    branch = meta.get("headRefName") or ""
    template_path = PROMPTS_DIR / "merge.md"
    if not template_path.exists():
        return {"error": "prompts/merge.md missing"}
    tpl = template_path.read_text()
    prompt = (tpl.replace("$PR_NUMBER", str(pr_num))
                 .replace("$PR_BRANCH", branch)
                 .replace("$REPO_ROOT", str(REPO_ROOT)))
    prompt_file = STATE_DIR / f"merge-prompt-{pr_num}.md"
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    prompt_file.write_text(prompt)
    return {
        "pr": pr_num,
        "branch": branch,
        "url": meta.get("url"),
        "prompt_file": str(prompt_file),
    }


def prepare_proposal(slug_hint: str = ""):
    """Materialise the proposer prompt + an empty draft file.

    Unlike issue/PR prep this does not touch GitHub — it just renders the
    proposer template into state/ and points the wrapper at a fresh draft
    file the agent will fill in. Slug is for filenames only; the issue
    title comes out of the codex session.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", (slug_hint or "").lower()).strip("-")[:32]
    if not slug:
        slug = "draft-" + time.strftime("%Y%m%d-%H%M%S")
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    draft_file  = STATE_DIR / f"proposal-{slug}.md"
    prompt_file = STATE_DIR / f"proposal-prompt-{slug}.md"
    template_path = PROMPTS_DIR / "propose.md"
    if not template_path.exists():
        return {"error": "prompts/propose.md missing"}
    tpl = template_path.read_text()
    prompt = (tpl.replace("$DRAFT_FILE", str(draft_file))
                 .replace("$SLUG", slug)
                 .replace("$REPO_ROOT", str(REPO_ROOT)))
    prompt_file.write_text(prompt)
    if not draft_file.exists():
        draft_file.write_text("")  # empty placeholder so $DRAFT_FILE always exists
    return {
        "slug": slug,
        "prompt_file": str(prompt_file),
        "draft_file": str(draft_file),
    }


def spawn_review(pr_num: int):
    if not (1 <= pr_num <= 9999):
        return {"error": "bad pr number"}
    script = REPO_ROOT / "researchloop-dev" / "agent-runner" / "orchestrate.sh"
    log_file = STATE_DIR / f"review-spawn-{pr_num}.out"
    # Match the implementer: codex with gpt-5.4-mini for the verdict generation.
    # The reviewer agent doesn't need network — the diff + issue body are
    # already embedded in the prompt; orchestrate.sh captures stdout and posts
    # it via `gh pr comment` itself.
    env = os.environ.copy()
    env.setdefault("REVIEWER", "codex")
    env.setdefault("CODEX_MODEL", CODEX_MODEL)
    try:
        fh = open(log_file, "w")
        subprocess.Popen(
            [str(script), "--review", str(pr_num)],
            cwd=str(REPO_ROOT),
            stdout=fh, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
    except Exception as e:
        return {"error": f"spawn failed: {e}"}
    invalidate_caches()
    return {"started": True, "pr": pr_num, "log": f"review-spawn-{pr_num}.out",
            "reviewer": env["REVIEWER"], "model": env["CODEX_MODEL"]}


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
        if u.path == "/api/issue":
            qs = dict(p.split("=", 1) for p in (u.query.split("&") if u.query else []) if "=" in p)
            try:
                num = int(unquote(qs.get("num", "")))
            except ValueError:
                return self._send_json({"error": "bad num"}, 400)
            if not (1 <= num <= 9999):
                return self._send_json({"error": "bad num"}, 400)
            # Skip --jq here — it forces gh to take the GraphQL path on some
            # commands and that's been hanging / EOF-ing intermittently. Plain
            # --json comes back over REST and is reliable.
            try:
                r = subprocess.run(
                    ["gh", "issue", "view", str(num), "--json", "body,title,labels,url"],
                    capture_output=True, text=True, timeout=15, check=True,
                )
                raw = json.loads(r.stdout)
                return self._send_json({
                    "body":   raw.get("body", ""),
                    "title":  raw.get("title", ""),
                    "url":    raw.get("url", ""),
                    "labels": [l.get("name") for l in raw.get("labels", []) if isinstance(l, dict)],
                })
            except subprocess.CalledProcessError as e:
                return self._send_json({"error": (e.stderr or "").strip() or str(e)}, 500)
            except json.JSONDecodeError as e:
                return self._send_json({"error": f"bad gh JSON: {e}"}, 500)

        if u.path == "/api/issues":
            return self._send_json({"issues": list_issues()})
        if u.path == "/api/prs":
            return self._send_json({"prs": list_prs()})
        if u.path == "/api/pty/list":
            reap_dead_ptys()
            return self._send_json({"sessions": list_ptys()})
        if u.path == "/api/pty/stream":
            qs = dict(p.split("=", 1) for p in (u.query.split("&") if u.query else []) if "=" in p)
            sid = unquote(qs.get("sid", ""))
            try:
                offset = max(0, int(qs.get("offset", "0") or 0))
            except ValueError:
                return self._send_json({"error": "bad offset"}, 400)
            try:
                timeout = max(1, min(25, int(qs.get("timeout", "15") or 15)))
            except ValueError:
                timeout = 15
            res = pty_read(sid, offset, timeout=timeout)
            if res is None:
                return self._send_json({"error": "unknown sid"}, 404)
            data, logical_len, alive, drop, reset = res
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("X-Offset", str(logical_len))
            self.send_header("X-Alive", "1" if alive else "0")
            self.send_header("X-Drop", str(drop))
            self.send_header("X-Reset", "1" if reset else "0")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
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

        if u.path == "/api/pty/new":
            kind = payload.get("kind", "shell")
            rows = int(payload.get("rows") or 30)
            cols = int(payload.get("cols") or 120)
            if kind == "shell":
                cwd_in = payload.get("cwd")
                if not cwd_in:
                    cwd_path = REPO_ROOT.resolve()
                else:
                    p = Path(cwd_in)
                    if not p.is_absolute():
                        p = REPO_ROOT / p
                    cwd_path = p.resolve()
                # Sandbox: cwd must be inside REPO_ROOT.
                try:
                    cwd_path.relative_to(REPO_ROOT.resolve())
                except ValueError:
                    return self._send_json({"error": "cwd must be inside repo"}, 400)
                env_extra = {"PS1": "\\[\\e[36m\\]agent\\[\\e[0m\\]:\\W$ "}
                res = spawn_shell_session(cwd_path, env_extra=env_extra)
                if res.get("error"):
                    return self._send_json(res, 400)
                # Apply requested geometry
                pty_resize(res["sid"], rows, cols)
                return self._send_json(res)
            if kind == "pr-review":
                try:
                    pr = int(payload.get("pr"))
                except (TypeError, ValueError):
                    return self._send_json({"error": "pr must be int"}, 400)
                prep = prepare_pr_review(pr)
                if prep.get("error"):
                    return self._send_json(prep, 400)
                prompt_file = prep["prompt_file"]
                review_out  = STATE_DIR / f"review-{pr}.md"

                model = payload.get("model") or CODEX_MODEL
                bin_  = payload.get("bin")   or CODEX_BIN
                yolo  = payload.get("yolo_flag") or CODEX_YOLO

                pr_url_file = STATE_DIR / f"review-{pr}.url"
                pr_url_file.unlink(missing_ok=True)
                env_extra = {
                    "PR_NUMBER": str(pr),
                    "REVIEW_OUT": str(review_out),
                    "REVIEW_URL_FILE": str(pr_url_file),
                    "PROMPT_FILE": prompt_file,
                    "PS1": "\\[\\e[35m\\]review·PR#" + str(pr) + "\\[\\e[0m\\]:\\W$ ",
                }

                # Interactive codex --yolo. The reviewer prompt instructs codex
                # to WRITE its verdict to $REVIEW_OUT and exit (not echo to chat),
                # so we get a clean markdown file we can auto-post after exit.
                # `--save-to` is captured by gh and we write the comment URL into
                # $REVIEW_URL_FILE so the dashboard can surface it above the term.
                wrapper = (
                    'touch $REVIEW_OUT; '
                    'echo "──── starting {bin} ({yolo_short}) review of PR #{pr} ────"; '
                    'echo "      model:  {model}"; '
                    'echo "      prompt: $PROMPT_FILE"; '
                    'echo "      out:    $REVIEW_OUT  (codex writes verdict here)"; '
                    'echo "────"; '
                    '{bin} {yolo} -m {model_q} -- "$(cat {prompt_q})"; '
                    'ec=$?; '
                    'echo; '
                    'echo "──── {bin} exited (code $ec) ────"; '
                    'if [ -s "$REVIEW_OUT" ]; then '
                        'echo "  $REVIEW_OUT has $(wc -l < $REVIEW_OUT) lines — posting to PR #{pr}…"; '
                        'url=$(gh pr comment {pr} -F $REVIEW_OUT 2>&1); '
                        'echo "  $url"; '
                        'echo "$url" | grep -Eo \'https://github.com/[^ ]+\' | head -1 > $REVIEW_URL_FILE; '
                        'echo "  comment url saved to $REVIEW_URL_FILE"; '
                    'else '
                        'echo "  $REVIEW_OUT is empty — codex did not produce a verdict file."; '
                        'echo "  to post manually: gh pr comment {pr} -F $REVIEW_OUT (after writing it)"; '
                    'fi; '
                    'echo; '
                    'exec {shell} -i'
                ).format(
                    pr=pr,
                    model=model,
                    model_q=shlex.quote(model),
                    bin=shlex.quote(bin_),
                    yolo=yolo,
                    yolo_short="yolo" if ("bypass" in yolo or "yolo" in yolo) else yolo,
                    prompt_q=shlex.quote(prompt_file),
                    shell=shlex.quote(USER_SHELL),
                )
                argv = ["bash", "-c", wrapper]
                sess = spawn_pty(argv, cwd=str(REPO_ROOT),
                                 env_extra=env_extra,
                                 label=f"codex review · PR #{pr}",
                                 rows=rows, cols=cols)
                # Best-effort fetch PR URL so the UI can render a clickable link.
                pr_url = None
                try:
                    pr_url = subprocess.run(
                        ["gh", "pr", "view", str(pr), "--json", "url", "--jq", ".url"],
                        capture_output=True, text=True, timeout=10, check=True,
                    ).stdout.strip() or None
                except Exception:
                    pass
                return self._send_json({
                    "sid": sess["sid"],
                    "label": sess["label"],
                    "cwd": sess["cwd"],
                    "pr": pr,
                    "pr_url": pr_url,
                    "issue": prep.get("issue"),
                    "model": model,
                    "prompt_file": prompt_file,
                    "review_out": str(review_out),
                    "review_url_file": str(pr_url_file),
                })

            if kind == "merge-pr":
                try:
                    pr = int(payload.get("pr"))
                except (TypeError, ValueError):
                    return self._send_json({"error": "pr must be int"}, 400)
                prep = prepare_merge(pr)
                if prep.get("error"):
                    return self._send_json(prep, 400)
                prompt_file = prep["prompt_file"]
                branch = prep["branch"]
                pr_url = prep.get("url")

                model = payload.get("model") or CODEX_MODEL
                bin_  = payload.get("bin")   or CODEX_BIN
                yolo  = payload.get("yolo_flag") or CODEX_YOLO

                env_extra = {
                    "PR_NUMBER": str(pr),
                    "PR_BRANCH": branch,
                    "PROMPT_FILE": prompt_file,
                    "PS1": "\\[\\e[31m\\]merge·PR#" + str(pr) + "\\[\\e[0m\\]:\\W$ ",
                }
                wrapper = (
                    'echo "──── starting {bin} ({yolo_short}) merge of PR #{pr} ────"; '
                    'echo "      model:  {model}"; '
                    'echo "      branch: $PR_BRANCH"; '
                    'echo "      prompt: $PROMPT_FILE"; '
                    'echo "────"; '
                    '{bin} {yolo} -m {model_q} -- "$(cat {prompt_q})"; '
                    'ec=$?; '
                    'echo; '
                    'echo "──── {bin} exited (code $ec) — dropping to shell ────"; '
                    'echo "  PR state: $(gh pr view {pr} --json state,mergedAt --jq \'.state + (if .mergedAt then \" (merged \" + .mergedAt + \")\" else \"\" end)\' 2>/dev/null)"; '
                    'exec {shell} -i'
                ).format(
                    pr=pr,
                    model=model,
                    model_q=shlex.quote(model),
                    bin=shlex.quote(bin_),
                    yolo=yolo,
                    yolo_short="yolo" if ("bypass" in yolo or "yolo" in yolo) else yolo,
                    prompt_q=shlex.quote(prompt_file),
                    shell=shlex.quote(USER_SHELL),
                )
                argv = ["bash", "-c", wrapper]
                sess = spawn_pty(argv, cwd=str(REPO_ROOT),
                                 env_extra=env_extra,
                                 label=f"codex merge · PR #{pr}",
                                 rows=rows, cols=cols)
                return self._send_json({
                    "sid": sess["sid"],
                    "label": sess["label"],
                    "cwd": sess["cwd"],
                    "pr": pr,
                    "pr_url": pr_url,
                    "branch": branch,
                    "model": model,
                    "prompt_file": prompt_file,
                })

            if kind == "propose-issue":
                slug_hint = (payload.get("slug") or "").strip()
                prep = prepare_proposal(slug_hint)
                if prep.get("error"):
                    return self._send_json(prep, 400)
                slug = prep["slug"]
                prompt_file = prep["prompt_file"]
                draft_file  = prep["draft_file"]

                model = payload.get("model") or CODEX_MODEL
                bin_  = payload.get("bin")   or CODEX_BIN
                yolo  = payload.get("yolo_flag") or CODEX_YOLO

                env_extra = {
                    "DRAFT_FILE": draft_file,
                    "PROPOSAL_SLUG": slug,
                    "PROMPT_FILE": prompt_file,
                    "PS1": "\\[\\e[32m\\]propose·" + slug + "\\[\\e[0m\\]:\\W$ ",
                }

                # Same shape as the issue terminal — interactive codex --yolo,
                # then drop to shell with the gh create command pre-printed.
                wrapper = (
                    'echo "──── starting {bin} ({yolo_short}) — propose new issue ────"; '
                    'echo "      model:  {model}"; '
                    'echo "      slug:   {slug}"; '
                    'echo "      draft:  $DRAFT_FILE  (codex will fill this in)"; '
                    'echo "      prompt: $PROMPT_FILE"; '
                    'echo "────"; '
                    '{bin} {yolo} -m {model_q} -- "$(cat {prompt_q})"; '
                    'ec=$?; '
                    'echo; '
                    'echo "──── {bin} exited (code $ec) — dropping to shell ────"; '
                    'if [ -s "$DRAFT_FILE" ]; then '
                        'echo "  draft saved to $DRAFT_FILE — preview:"; '
                        'echo "  ────"; '
                        'head -20 "$DRAFT_FILE" | sed \'s/^/  | /\'; '
                        'echo "  ────"; '
                        'title=$(head -1 "$DRAFT_FILE" | sed \'s/^# *//\'); '
                        'echo "  to create the issue:"; '
                        'echo "    gh issue create --title \\"$title\\" --body-file $DRAFT_FILE --label agent-friendly --label claim-next"; '
                    'else '
                        'echo "  $DRAFT_FILE is empty — codex did not produce a draft."; '
                    'fi; '
                    'exec {shell} -i'
                ).format(
                    bin=shlex.quote(bin_),
                    yolo=yolo,
                    yolo_short="yolo" if ("bypass" in yolo or "yolo" in yolo) else yolo,
                    slug=slug,
                    model=model,
                    model_q=shlex.quote(model),
                    prompt_q=shlex.quote(prompt_file),
                    shell=shlex.quote(USER_SHELL),
                )
                argv = ["bash", "-c", wrapper]
                sess = spawn_pty(argv, cwd=str(REPO_ROOT),
                                 env_extra=env_extra,
                                 label=f"propose · {slug}",
                                 rows=rows, cols=cols)
                return self._send_json({
                    "sid": sess["sid"],
                    "label": sess["label"],
                    "cwd": sess["cwd"],
                    "slug": slug,
                    "model": model,
                    "prompt_file": prompt_file,
                    "draft_file": draft_file,
                })

            if kind == "issue-shell":
                try:
                    issue = int(payload.get("issue"))
                except (TypeError, ValueError):
                    return self._send_json({"error": "issue must be int"}, 400)
                prep = prepare_issue_worktree(issue)
                if prep.get("error"):
                    return self._send_json(prep, 400)
                wt = Path(prep["worktree"])
                prompt_file = prep.get("prompt_file") or ""
                if not prompt_file or not Path(prompt_file).exists():
                    return self._send_json({"error": "prompt file missing — worktree prep incomplete"}, 500)

                model = payload.get("model") or CODEX_MODEL
                bin_  = payload.get("bin")   or CODEX_BIN
                yolo  = payload.get("yolo_flag") or CODEX_YOLO

                env_extra = {
                    "AGENT_ISSUE": str(issue),
                    "AGENT_BRANCH": prep.get("branch", ""),
                    "AGENT_PROMPT_FILE": prompt_file,
                    "PS1": "\\[\\e[33m\\]#" + str(issue) + "\\[\\e[0m\\]:\\W$ ",
                }

                # Spawn codex directly under the PTY. Wrapped in bash so:
                #   1) we print a banner the user can see in the terminal
                #   2) when codex exits we drop into an interactive shell in
                #      the worktree instead of closing the session
                # The prompt is read via $(cat …) so we don't have to worry
                # about shell quoting on multi-line markdown.
                wrapper = (
                    'echo "──── starting {bin} ({yolo_short}) on issue #{issue} ────"; '
                    'echo "      model:  {model}"; '
                    'echo "      branch: $AGENT_BRANCH"; '
                    'echo "      prompt: $AGENT_PROMPT_FILE"; '
                    'echo "────"; '
                    '{bin} {yolo} -m {model_q} -- "$(cat \"$AGENT_PROMPT_FILE\")"; '
                    'ec=$?; '
                    'echo; '
                    'echo "──── {bin} exited (code $ec) — dropping to shell ────"; '
                    'exec {shell} -i'
                ).format(
                    bin=shlex.quote(bin_),
                    yolo=yolo,                           # multi-token flag string, not quoted
                    yolo_short="yolo" if "bypass" in yolo or "yolo" in yolo else yolo,
                    issue=issue,
                    model=model,
                    model_q=shlex.quote(model),
                    shell=shlex.quote(USER_SHELL),
                )
                argv = ["bash", "-c", wrapper]
                sess = spawn_pty(argv, cwd=str(wt), env_extra=env_extra,
                                 label=f"codex #{issue} · {wt.name}",
                                 rows=rows, cols=cols)
                return self._send_json({
                    "sid": sess["sid"],
                    "label": sess["label"],
                    "cwd": sess["cwd"],
                    "issue": issue,
                    "branch": prep.get("branch"),
                    "prompt_file": prompt_file,
                    "model": model,
                })
            return self._send_json({"error": f"unknown kind: {kind}"}, 400)

        if u.path == "/api/pty/input":
            sid = payload.get("sid", "")
            data = payload.get("data", "")
            if not isinstance(data, str):
                return self._send_json({"error": "data must be string"}, 400)
            ok = pty_write(sid, data.encode("utf-8", errors="replace"))
            return self._send_json({"ok": ok})

        if u.path == "/api/pty/resize":
            sid = payload.get("sid", "")
            try:
                rows = int(payload.get("rows"))
                cols = int(payload.get("cols"))
            except (TypeError, ValueError):
                return self._send_json({"error": "rows/cols must be int"}, 400)
            ok = pty_resize(sid, rows, cols)
            return self._send_json({"ok": ok})

        if u.path == "/api/pty/close":
            sid = payload.get("sid", "")
            ok = kill_pty(sid)
            return self._send_json({"ok": ok})

        if u.path == "/api/state/cleanup":
            try:
                stale_days = int(payload.get("stale_days", 7))
            except (TypeError, ValueError):
                return self._send_json({"error": "stale_days must be int"}, 400)
            dry = bool(payload.get("dry_run", False))
            cutoff = time.time() - max(0, stale_days) * 86400
            # Sanctioned prefixes — never touch .gitignore or unknown files.
            CLEAN_PREFIXES = (
                "implementer-", "orchestrator-", "review-spawn-",
                "review-prompt-", "review-",
                "pr-", "issue-", "prompt-",
                "proposal-", "proposal-prompt-",
            )
            removed, kept = [], []
            total_freed = 0
            for p in sorted(STATE_DIR.iterdir()):
                if not p.is_file():
                    continue
                if not any(p.name.startswith(pfx) for pfx in CLEAN_PREFIXES):
                    continue
                try:
                    st = p.stat()
                except OSError:
                    continue
                if st.st_mtime < cutoff:
                    if not dry:
                        try:
                            p.unlink()
                        except OSError as e:
                            kept.append({"name": p.name, "reason": str(e)})
                            continue
                    removed.append({"name": p.name, "size": st.st_size,
                                    "age_days": round((time.time() - st.st_mtime) / 86400, 1)})
                    total_freed += st.st_size
                else:
                    kept.append({"name": p.name, "size": st.st_size,
                                 "age_days": round((time.time() - st.st_mtime) / 86400, 1)})
            return self._send_json({
                "dry_run": dry,
                "stale_days": stale_days,
                "removed": removed,
                "kept_count": len(kept),
                "freed_bytes": total_freed,
            })

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
