/* GemHunter PWA — runs on GitHub Pages; research runs on GitHub Actions with your Claude plan. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");
const state = { pollers: [] };

/* ---------------- utilities ---------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function md(text) {
  const html = marked.parse(String(text || ""), { gfm: true, breaks: false });
  const clean = DOMPurify.sanitize(html);
  return clean.replace(/<a /g, '<a target="_blank" rel="noopener" ');
}
function money(v, digits) {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e5) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  if (a >= 1000) return `${sign}$${a.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sign}$${a.toFixed(digits ?? 2)}`;
}
const price = v => (v == null ? "—" : `$${Number(v).toFixed(v < 10 ? 2 : 2)}`);
const pct = (v, ratio = true) => (v == null || isNaN(v) ? "—" : `${(ratio ? v * 100 : v).toFixed(0)}%`);
const signedPct = (v, ratio = true) => {
  if (v == null || isNaN(v)) return "—";
  const x = ratio ? v * 100 : v;
  return `<span class="${x >= 0 ? "up" : "down"}">${x >= 0 ? "+" : ""}${x.toFixed(0)}%</span>`;
};
const when = iso => {
  if (!iso) return "";
  const d = new Date(iso), diff = (Date.now() - d) / 1000;
  if (diff < 90) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const robinhood = t => `https://robinhood.com/us/en/stocks/${encodeURIComponent(t)}/`;

function ratingClass(r) {
  if (!r) return "r-none";
  if (/strong buy|^buy|accumulate|^add/i.test(r)) return "r-buy";
  if (/hold|watch|review|research/i.test(r)) return "r-hold";
  if (/avoid|sell|trim/i.test(r)) return "r-avoid";
  return "r-none";
}
const ratingChip = r => (r ? `<span class="rating ${ratingClass(r)}">${esc(r)}</span>` : "");
const tone = r => ({ "r-buy": "var(--emerald)", "r-hold": "var(--citrine)", "r-avoid": "var(--garnet)" }[ratingClass(r)] || "var(--sapphire)");

/* The gem glyph: a cut stone whose body fills with the score, tinted by the rating. */
let gemId = 0;
function gem(score, rating, big = false) {
  const id = `g${++gemId}`, s = Math.max(0, Math.min(100, Number(score) || 0));
  const top = 44 - (s / 100) * 36, col = tone(rating);
  const shape = "14,8 34,8 42,18 24,44 6,18";
  return `<svg class="gem ${big ? "gem-lg" : ""}" viewBox="0 0 48 58" role="img" aria-label="Gem score ${Math.round(s)} of 100">
    <defs><clipPath id="${id}"><polygon points="${shape}"/></clipPath></defs>
    <polygon points="${shape}" fill="var(--surface)"/>
    <rect clip-path="url(#${id})" x="0" y="${top}" width="48" height="48" fill="${col}" opacity=".85"/>
    <g fill="none" stroke="var(--ink)" stroke-width="1.1" stroke-linejoin="round" opacity=".75">
      <polygon points="${shape}"/><path d="M6 18h36M14 8l4 10 6-10 6 10 4-10M18 18l6 26 6-26"/>
    </g>
    <text class="score" x="24" y="56" text-anchor="middle">${score == null ? "" : Math.round(s)}</text>
  </svg>`;
}

function sparkline(vals, w = 76, h = 26) {
  vals = (vals || []).filter(v => v != null);
  if (vals.length < 2) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - lo) / span) * (h - 4)}`);
  const col = vals[vals.length - 1] >= vals[0] ? "var(--emerald)" : "var(--garnet)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M${pts.join("L")}" stroke="${col}"/></svg>`;
}

function lineChart(series, w = 340, h = 150) {
  if (!series || series.length < 2) return "";
  const vals = series.map(p => p[1]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = i => 4 + (i / (series.length - 1)) * (w - 8), y = v => h - 22 - ((v - lo) / span) * (h - 36);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const col = vals[vals.length - 1] >= vals[0] ? "var(--emerald)" : "var(--garnet)";
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Weekly closing price, past year">
    <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <text x="4" y="12" font-size="11" fill="var(--ink-3)">${price(hi)}</text>
    <text x="4" y="${h - 6}" font-size="11" fill="var(--ink-3)">${price(lo)} · ${esc(series[0][0])}</text>
    <text x="${w - 4}" y="${h - 6}" font-size="11" fill="var(--ink-3)" text-anchor="end">${esc(series[series.length - 1][0])}</text>
  </svg>`;
}

function barChart(series, w = 340, h = 140) {
  series = (series || []).filter(p => p[1] != null);
  if (!series.length) return "";
  const hi = Math.max(...series.map(p => p[1])) || 1, bw = (w - 8) / series.length;
  const bars = series.map((p, i) => {
    const bh = (p[1] / hi) * (h - 40);
    return `<rect x="${4 + i * bw + 4}" y="${h - 22 - bh}" width="${bw - 8}" height="${Math.max(bh, 1)}" rx="3" fill="var(--sapphire)" opacity="${0.45 + 0.55 * (i / series.length)}"/>
      <text x="${4 + i * bw + bw / 2}" y="${h - 26 - bh}" font-size="10" text-anchor="middle" fill="var(--ink-2)">${money(p[1], 0).replace("$", "")}</text>
      <text x="${4 + i * bw + bw / 2}" y="${h - 7}" font-size="10" text-anchor="middle" fill="var(--ink-3)">${esc(p[0].slice(2, 7))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Quarterly revenue">${bars}</svg>`;
}

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

/* ---------------- GitHub storage + runs ----------------
   The private GemHunter-data repo is the backend: the app reads and writes JSON files
   there, and starts GitHub Actions runs that do the research on your Claude plan. */

const GH = "https://api.github.com";
const cfg = () => JSON.parse(localStorage.getItem("gh_cfg") || "null");

async function gh(path, { method = "GET", body, raw = false } = {}) {
  const c = cfg();
  const res = await fetch(GH + path, {
    method, cache: "no-store",
    headers: {
      Authorization: `Bearer ${c.token}`, "X-GitHub-Api-Version": "2022-11-28",
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin("GitHub rejected the token. It may have expired — make a new one."); throw new Error("Sign in needed"); }
  return res;
}

const contentsPath = p => `/repos/${cfg().repo}/contents/${p}?ref=${encodeURIComponent(cfg().branch)}`;

async function readJSON(path, fallback = null) {
  const r = await gh(contentsPath(path), { raw: true });
  if (r.status === 404) return fallback;
  if (!r.ok) throw new Error(`GitHub error ${r.status} reading ${path}`);
  return r.json();
}

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function updateJSON(path, fn, fallback, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const meta = await gh(contentsPath(path));
    let sha, cur = fallback;
    if (meta.ok) {
      const m = await meta.json();
      sha = m.sha;
      cur = m.content ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m.content.replace(/\n/g, "")), c => c.charCodeAt(0)))) : await readJSON(path, fallback);
    } else if (meta.status !== 404) throw new Error(`GitHub error ${meta.status} reading ${path}`);
    const next = fn(structuredClone(cur));
    const put = await gh(`/repos/${cfg().repo}/contents/${path}`, {
      method: "PUT", body: { message: message || `app: update ${path}`, branch: cfg().branch, content: b64(JSON.stringify(next, null, 1)), ...(sha ? { sha } : {}) },
    });
    if (put.ok) return next;
    if (put.status === 403) throw new Error("Your GitHub token can't write to the repo. Give it Contents: Read and write.");
    if (put.status !== 409 && put.status !== 422) throw new Error(`GitHub error ${put.status} saving ${path}`);
  }
  throw new Error(`Couldn't save ${path} — try again.`);
}

const KIND_TITLES = { dd: t => `Deep DD: ${t}`, scan: () => "Hidden-gem scan", review: () => "Portfolio review", refresh: () => "Refresh prices & filings", ask: () => "Question" };

function localJobs() { return JSON.parse(localStorage.getItem("gh_jobs") || "[]"); }
function saveLocalJobs(list) { localStorage.setItem("gh_jobs", JSON.stringify(list.slice(0, 40))); }

async function dispatch(kind, params = {}) {
  const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  const r = await gh(`/repos/${cfg().repo}/actions/workflows/run.yml/dispatches`, {
    method: "POST", body: { ref: cfg().branch, inputs: { kind, run_id: id, params: JSON.stringify(params) } },
  });
  if (r.status === 404) throw new Error("Couldn't find the run.yml workflow. Check that Actions is enabled in GemHunter-data.");
  if (r.status === 403) throw new Error("Your GitHub token can't start runs. Give it Actions: Read and write.");
  if (!r.ok) throw new Error(`GitHub error ${r.status} starting the run`);
  saveLocalJobs([{ id, kind, title: KIND_TITLES[kind](params.ticker || ""), created: new Date().toISOString(), done: false }, ...localJobs()]);
  return id;
}

async function ghRunFor(id) {
  const r = await gh(`/repos/${cfg().repo}/actions/workflows/run.yml/runs?per_page=30`);
  if (!r.ok) return null;
  const runs = (await r.json()).workflow_runs || [];
  return runs.find(x => (x.display_title || "").includes(id)) || null;
}

/* A run's state: the progress file the runner writes, plus GitHub's own status before it exists. */
async function getJob(id) {
  const local = localJobs().find(j => j.id === id);
  const p = await readJSON(`runs/${id}/progress.json`);
  let run = null;
  if (!p || p.status === "running") run = await ghRunFor(id);
  if (!p) {
    const failed = run && run.status === "completed";
    return { id, kind: local?.kind, title: local?.title || "Run", events: [], status: failed ? "error" : "starting",
      error: failed ? `The GitHub run ended (${run.conclusion}) before it could start. Open the log for details.` : null,
      log_url: run?.html_url, created: local?.created };
  }
  if (p.status === "running" && run && run.status === "completed") {
    p.status = "error";
    p.error = p.error || `The GitHub run stopped (${run.conclusion}).`;
  }
  p.log_url = run?.html_url || (p.gh_run ? `https://github.com/${cfg().repo}/actions/runs/${p.gh_run}` : null);
  if (["done", "error", "cancelled"].includes(p.status) && local && !local.done) {
    saveLocalJobs(localJobs().map(j => (j.id === id ? { ...j, done: true, status: p.status } : j)));
  }
  return p;
}

async function activeJobs() {
  const cutoff = Date.now() - 6 * 3600e3;
  const open = localJobs().filter(j => !j.done && new Date(j.created) > cutoff && j.kind !== "ask");
  const out = [];
  for (const j of open.slice(0, 4)) {
    try {
      const p = await getJob(j.id);
      if (p.status === "running" || p.status === "starting") out.push({ ...j, status: p.status });
    } catch { /* ignore */ }
  }
  return out;
}

/* ---------------- frame ---------------- */

function setTitle(text, { back = false, right = "" } = {}) {
  $("#title").textContent = text;
  $("#back").hidden = !back;
  $("#topbar-right").innerHTML = right;
  document.title = `${text} · GemHunter`;
}
$("#back").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/gems")));
addEventListener("scroll", () => $("#topbar").classList.toggle("scrolled", scrollY > 4), { passive: true });

function stopPolling() { state.pollers.forEach(clearTimeout); state.pollers = []; }

function openSheet(html) {
  const sh = $("#sheet");
  sh.innerHTML = `<div class="grab"></div>${html}`;
  sh.hidden = false;
  $("#sheet-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  return sh;
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet-backdrop").hidden = true;
  document.body.style.overflow = "";
}
$("#sheet-backdrop").addEventListener("click", closeSheet);
addEventListener("keydown", e => e.key === "Escape" && closeSheet());

function showLogin(message = "") {
  stopPolling();
  closeSheet();
  $("#tabbar").hidden = true;
  setTitle("GemHunter");
  const c = cfg() || {};
  view.innerHTML = `<div class="login">
    ${gem(72, "Buy", true).replace(">72<", "><")}
    <h2>Connect your GitHub</h2>
    ${message ? `<p class="down">${esc(message)}</p>` : ""}
    <p class="muted">GemHunter keeps your research in your private <b>GemHunter-data</b> repo and runs the agents there with GitHub Actions.</p>
    <form id="login-form">
      <label class="field"><span>Data repo</span><input type="text" id="repo" value="${esc(c.repo || "Swapnilpatel01/GemHunter-Data")}" autocapitalize="off" spellcheck="false" required></label>
      <label class="field"><span>GitHub access token</span><input type="password" id="tok" autocomplete="off" required>
        <small>A fine-grained token for GemHunter-data with <b>Contents</b> and <b>Actions</b> set to Read and write. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create one</a>.</small></label>
      <button class="btn block">Connect</button>
    </form></div>`;
  $("#login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const repo = $("#repo").value.trim().replace(/^https:\/\/github.com\//, "").replace(/\/$/, "");
    const token = $("#tok").value.trim();
    const r = await fetch(`${GH}/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!r.ok) return toast(r.status === 404 ? "Can't see that repo with this token. Check the name and the token's repo access." : `GitHub said ${r.status}. Check the token.`, 4500);
    const info = await r.json();
    localStorage.setItem("gh_cfg", JSON.stringify({ repo, token, branch: info.default_branch || "main" }));
    $("#tabbar").hidden = false;
    location.hash = "#/gems";
    route();
    autoRefresh();
  });
}

/* ---------------- router ---------------- */

const routes = [
  [/^#\/gems$/, viewGems, "gems"],
  [/^#\/research$/, viewResearch, "research"],
  [/^#\/job\/([\w-]+)$/, viewJob, "research"],
  [/^#\/report\/([\w-]+)$/, viewReport, "research"],
  [/^#\/portfolio$/, viewPortfolio, "portfolio"],
  [/^#\/settings$/, viewSettings, "settings"],
];

async function route() {
  if (!cfg()) return showLogin();
  stopPolling();
  closeSheet();
  const h = location.hash || "#/gems";
  for (const [re, fn, tab] of routes) {
    const m = h.match(re);
    if (m) {
      $$(".tabbar a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab));
      view.innerHTML = `<p class="faint" style="padding:24px 0">Loading…</p>`;
      try { await fn(...m.slice(1)); } catch (e) {
        if (e.message !== "Sign in needed") view.innerHTML = `<div class="empty"><h2>Couldn't load this</h2><p>${esc(e.message)}</p><button class="btn quiet" onclick="route()">Try again</button></div>`;
      }
      scrollTo(0, 0);
      return;
    }
  }
  location.hash = "#/gems";
}
addEventListener("hashchange", route);

/* ---------------- shared bits ---------------- */

async function unseenAlerts() {
  const alerts = await readJSON("alerts.json", []);
  const seen = localStorage.getItem("gh_alerts_seen") || "";
  const n = alerts.filter(a => (a.created || "") > seen).length;
  $('.tabbar a[data-tab="portfolio"] span').textContent = n ? `Portfolio (${n})` : "Portfolio";
  return { alerts, unseen: n };
}

function activeJobBanners(jobs) {
  return (jobs || []).map(j => `<a class="banner" href="#/job/${j.id}"><span class="pulse"></span>
    <span><b>${esc(j.title)}</b><br><span class="small muted">${j.status === "starting" ? "Starting a GitHub runner" : "Agents are working — tap to watch"}</span></span></a>`).join("");
}

async function startDD(ticker, screenContext = "") {
  const id = await dispatch("dd", { ticker, screen_context: screenContext });
  closeSheet();
  location.hash = `#/job/${id}`;
}

async function watch(ticker) {
  await updateJSON("portfolio.json", p => {
    p.watchlist = (p.watchlist || []).filter(w => w.ticker !== ticker);
    p.watchlist.push({ ticker });
    return p;
  }, { holdings: [], cash: 0, watchlist: [] }, `app: watch ${ticker}`);
  toast(`${ticker} added to your watchlist`);
}

/* Live prices and filing alerts are refreshed by a small, AI-free run each time you open the app. */
async function autoRefresh() {
  try {
    if (!cfg()) return;
    const [pf, prices] = await Promise.all([readJSON("portfolio.json", {}), readJSON("prices.json")]);
    const n = (pf?.holdings?.length || 0) + (pf?.watchlist?.length || 0);
    if (!n) return;
    const age = prices?.updated ? Date.now() - new Date(prices.updated) : Infinity;
    const pending = localJobs().some(j => j.kind === "refresh" && !j.done && Date.now() - new Date(j.created) < 15 * 60e3);
    if (age > 30 * 60e3 && !pending) {
      await dispatch("refresh", {});
      toast("Refreshing prices and filings in the background");
    }
  } catch { /* the app works without it */ }
}

/* ---------------- Gems ---------------- */

async function viewGems() {
  setTitle("Hidden gems");
  const [scan, jobs, al] = await Promise.all([readJSON("scans/latest.json", { candidates: [], meta: {} }), activeJobs(), unseenAlerts()]);
  const meta = scan.meta || {};
  const cands = scan.candidates || [];
  const alerts = al.unseen ? `<a class="banner warn" href="#/portfolio"><span><b>${al.unseen} new filing alert${al.unseen > 1 ? "s" : ""}</b><br><span class="small">On stocks you own or watch</span></span></a>` : "";
  const scanning = jobs.some(j => j.kind === "scan");

  let body;
  if (!cands.length) {
    body = `<div class="empty"><h2>No scan yet</h2>
      <p>A scan reads SEC filings for every US stock between $50M and $10B, ranks them on growth, margins, valuation, insider buying and how little Wall Street covers them, then sends the best few to the research team for full due diligence.</p>
      <p class="faint">The screen alone takes a few minutes and uses no AI. Each deep DD uses about 15 agent calls on your Claude plan and roughly 10 minutes of GitHub time.</p></div>`;
  } else {
    body = `<p class="faint">Scanned ${meta.scored ?? "?"} of ${meta.in_range ?? "?"} stocks in range, latest quarter ${esc(meta.quarter || "")}, ${when(scan.created)}.</p>
      <ul class="list">${cands.map((c, i) => gemRow(c, i)).join("")}</ul>`;
  }
  view.innerHTML = `${alerts}${activeJobBanners(jobs)}
    <div class="row-actions">
      <button class="btn" id="scan" ${scanning ? "disabled" : ""}>${cands.length ? "Run a new scan" : "Find hidden gems"}</button>
      <button class="btn quiet" id="screen-only" ${scanning ? "disabled" : ""}>Screen only</button>
    </div>${body}`;
  $("#scan").onclick = async () => { location.hash = `#/job/${await dispatch("scan", { screen_only: false })}`; };
  $("#screen-only").onclick = async () => { location.hash = `#/job/${await dispatch("scan", { screen_only: true })}`; };
  $$("[data-cand]").forEach(el => el.addEventListener("click", () => candidateSheet(cands[+el.dataset.cand])));
  if (jobs.length) state.pollers.push(setTimeout(() => location.hash === "#/gems" && viewGems(), 20000));
}

function gemRow(c, i) {
  const score = c.ai_gem_score ?? c.gem_score;
  return `<li><button class="rowlink" data-cand="${i}" style="width:100%;text-align:left;background:none;border:0">
    <div class="gemrow">${gem(score, c.rating)}
      <div style="min-width:0">
        <div class="meta"><span class="ticker" style="font-size:22px">${esc(c.ticker)}</span>${ratingChip(c.rating)}</div>
        <div class="name">${esc((c.name || "").replace(/ (Common Stock|Class A.*|Ordinary Shares.*)$/i, ""))}</div>
        <div class="reasons">${esc((c.reasons || []).slice(0, 2).join("; "))}</div>
      </div>
      <div class="right">${sparkline(c.sparkline)}<span class="small">${money(c.market_cap)}</span>
        <span class="small">${c.rev_yoy != null ? signedPct(c.rev_yoy) + " rev" : ""}</span></div>
    </div></button></li>`;
}

function candidateSheet(c) {
  const rows = [
    ["Price", price(c.price)], ["Market cap", money(c.market_cap)], ["Sector", c.sector || "—"],
    ["Revenue YoY", signedPct(c.rev_yoy)], ["Growth change", c.rev_accel != null ? `${(c.rev_accel * 100).toFixed(0)} pts` : "—"],
    ["Gross margin", pct(c.gross_margin)], ["Op. margin", pct(c.op_margin)], ["P/S (annualized)", c.ps_annualized ? c.ps_annualized.toFixed(1) + "×" : "—"],
    ["Analysts", c.analysts ?? "0"], ["Institutions own", pct(c.inst_pct)], ["Insiders own", pct(c.insider_pct)],
    ["Short interest", pct(c.short_pct)], ["6-month return", signedPct(c.return_6m, false)], ["Screen score", c.stage1_score], ["Gem score", c.gem_score],
  ];
  const sh = openSheet(`
    <div class="hero"><div><div class="ticker" style="font-size:36px">${esc(c.ticker)}</div><div class="co">${esc(c.name || "")}</div></div>${gem(c.ai_gem_score ?? c.gem_score, c.rating, true)}</div>
    <h3>Why it was flagged</h3><ul>${(c.reasons || []).map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    <dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    <div class="row-actions">
      ${c.report_id ? `<a class="btn" href="#/report/${c.report_id}">Read the DD</a>` : `<button class="btn" id="dd">Run deep DD</button>`}
      <a class="btn rh" href="${robinhood(c.ticker)}" target="_blank" rel="noopener">Open in Robinhood</a>
      <button class="btn quiet" id="w">Watch</button>
    </div>`);
  const dd = $("#dd", sh);
  if (dd) dd.onclick = () => startDD(c.ticker, (c.reasons || []).join("; "));
  $("#w", sh).onclick = () => watch(c.ticker);
  $$("a[href^='#']", sh).forEach(a => a.addEventListener("click", closeSheet));
}

/* ---------------- Research ---------------- */

let tickerList = null;
async function searchTickers(q) {
  if (!tickerList) tickerList = (await readJSON("tickers.json", { tickers: [] })).tickers || [];
  q = q.toUpperCase();
  const exact = tickerList.filter(([t]) => t === q);
  const pref = tickerList.filter(([t]) => t.startsWith(q) && t !== q).sort((a, b) => a[0].length - b[0].length);
  const name = q.length >= 3 ? tickerList.filter(([t, n]) => n.toUpperCase().includes(q) && !t.startsWith(q)) : [];
  return [...exact, ...pref, ...name].slice(0, 12).map(([ticker, name]) => ({ ticker, name }));
}

async function viewResearch() {
  setTitle("Research");
  const [index, jobs] = await Promise.all([readJSON("reports/index.json", []), activeJobs()]);
  const recent = localJobs().filter(j => j.kind !== "ask").slice(0, 8);
  view.innerHTML = `${activeJobBanners(jobs)}
    <label class="field"><span>Research any stock</span>
      <input type="search" id="q" placeholder="Ticker or company name" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    <ul class="suggest" id="sug" hidden></ul>
    <h2>Due diligence reports</h2>
    ${index.length ? `<ul class="list">${index.slice(0, 80).map(r => `<li><a class="rowlink" href="#/report/${r.id}"><div class="gemrow">
        ${gem(r.gem_score, r.rating)}<div style="min-width:0"><div class="meta"><span class="ticker" style="font-size:20px">${esc(r.ticker)}</span>${ratingChip(r.rating)}</div>
        <div class="reasons">${esc(r.one_liner || r.name || "")}</div></div>
        <div class="right"><span class="faint">${when(r.created)}</span><span class="small">${r.action ? esc(r.action) : ""}</span></div></div></a></li>`).join("")}</ul>`
      : `<p class="muted">No reports yet. Search for a ticker above, or run a scan from Gems.</p>`}
    ${recent.length ? `<h2>Recent runs</h2><ul class="list">${recent.map(j => `<li><a class="rowlink" href="#/job/${j.id}">
      <b>${esc(j.title)}</b><br><span class="faint">${esc(j.status || (j.done ? "finished" : "started"))}, ${when(j.created)}</span></a></li>`).join("")}</ul>` : ""}`;

  const q = $("#q"), sug = $("#sug");
  let timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = q.value.trim();
      if (!v) return (sug.hidden = true);
      const res = await searchTickers(v).catch(() => []);
      sug.innerHTML = res.map(r => `<li><button data-t="${esc(r.ticker)}"><b>${esc(r.ticker)}</b><span class="muted">${esc(r.name)}</span></button></li>`).join("")
        || `<li><button data-t="${esc(v.toUpperCase())}"><b>${esc(v.toUpperCase())}</b><span class="muted">Research this ticker</span></button></li>`;
      sug.hidden = false;
      $$("button", sug).forEach(b => (b.onclick = () => tickerSheet(b.dataset.t)));
    }, 200);
  });
  q.addEventListener("keydown", e => { if (e.key === "Enter" && q.value.trim()) tickerSheet(q.value.trim().toUpperCase()); });
  if (jobs.length) state.pollers.push(setTimeout(() => location.hash === "#/research" && viewResearch(), 20000));
}

async function tickerSheet(t) {
  const past = (await readJSON("reports/index.json", [])).filter(r => r.ticker === t).slice(0, 5);
  const sh = openSheet(`<div class="ticker" style="font-size:36px">${esc(t)}</div>
    <p class="muted">The research team reads the latest 10-K, 10-Q, 8-Ks, earnings release, insider trades and news, debates it, and writes a full DD. It takes about 10 minutes and roughly 15 agent calls on your Claude plan. You can close the app while it runs.</p>
    <div class="row-actions"><button class="btn" id="dd">Run deep DD</button>
      <a class="btn rh" href="${robinhood(t)}" target="_blank" rel="noopener">Open in Robinhood</a>
      <button class="btn quiet" id="w">Watch</button>
      <button class="btn quiet" id="ask">Quick question</button></div>
    ${past.length ? `<h3>Earlier reports</h3><ul class="list">${past.map(r => `<li><a class="rowlink" href="#/report/${r.id}">${ratingChip(r.rating)} <span class="faint">${when(r.created)}</span><br>${esc(r.one_liner || "")}</a></li>`).join("")}</ul>` : ""}`);
  $("#dd", sh).onclick = () => startDD(t);
  $("#w", sh).onclick = () => watch(t);
  $("#ask", sh).onclick = () => askSheet({ ticker: t, title: `Ask about ${t}` });
  $$("a[href^='#']", sh).forEach(a => a.addEventListener("click", closeSheet));
}

/* ---------------- Live run: the agent room ---------------- */

const DD_STAGES = [["data", "Gather filings, financials, news"], ["analysts", "Analyst team"], ["debate", "Bull vs bear debate"],
  ["verdict", "Research manager verdict"], ["risk", "Trader plan and risk debate"], ["decision", "Portfolio manager decision"], ["writeup", "Write the DD"]];

async function viewJob(id) {
  setTitle("Research run", { back: true });
  view.innerHTML = `<div id="jobhead"></div><ol class="stages" id="stages"></ol><div class="log" id="log"></div><div id="room"></div>`;
  async function tick() {
    try {
      const j = await getJob(id);
      if (location.hash !== `#/job/${id}`) return;
      render(j);
      if (j.status === "starting" || j.status === "running") state.pollers.push(setTimeout(tick, j.status === "starting" ? 5000 : 3500));
    } catch (e) { if (e.message !== "Sign in needed") state.pollers.push(setTimeout(tick, 8000)); }
  }
  tick();
}

function render(j) {
  const ev = j.events || [];
  setTitle(j.title || "Research run", { back: true });
  let startIdx = 0;
  ev.forEach((e, i) => { if (e.type === "stage" && e.stage === "dd") startIdx = i; });
  const cur = ev.slice(startIdx);
  const stagesSeen = cur.filter(e => e.type === "stage").map(e => e.stage);
  const running = j.status === "running" || j.status === "starting";
  const statusLine = {
    starting: "Starting a GitHub runner — this usually takes under a minute.",
    running: "Working on GitHub. You can close the app; the report will be here when you come back.",
    done: "Finished.", error: `Stopped: ${j.error || "unknown error"}`, cancelled: "Cancelled.",
  }[j.status] || j.status;
  const ddStage = ev.filter(e => e.stage === "dd").pop();
  const screenDone = ev.find(e => e.type === "screen_done");
  const reportId = j.result?.report_id;
  $("#jobhead").innerHTML = `<p class="${j.status === "error" ? "down" : "muted"}">${esc(statusLine)}</p>
    ${screenDone ? `<p class="small">Screen found ${screenDone.count} candidates.${screenDone.top.length ? ` Deep research on: <b>${esc(screenDone.top.join(", "))}</b>.` : ""}</p>` : ""}
    ${ddStage ? `<h2>${esc(ddStage.label)}</h2>` : ""}
    ${j.kind === "ask" && j.result?.answer ? `<div class="md">${md(j.result.answer)}</div>` : ""}
    <div class="row-actions">
      ${reportId ? `<a class="btn" href="#/report/${reportId}">Read the DD</a>` : ""}
      ${j.kind === "scan" && j.status === "done" ? `<a class="btn" href="#/gems">See the gems</a>` : ""}
      ${j.kind === "review" && j.status === "done" ? `<a class="btn" href="#/portfolio">See the review</a>` : ""}
      ${running && j.gh_run ? `<button class="btn danger small" id="cancel">Cancel</button>` : ""}
      ${j.log_url ? `<a class="btn ghost small" href="${esc(j.log_url)}" target="_blank" rel="noopener">GitHub log</a>` : ""}
    </div>`;
  const c = $("#cancel");
  if (c) c.onclick = async () => { await gh(`/repos/${cfg().repo}/actions/runs/${j.gh_run}/cancel`, { method: "POST" }); toast("Cancelling the run"); };

  let stages = [];
  if (j.kind === "dd" || ddStage) stages = DD_STAGES;
  else if (j.kind === "scan") stages = [["screen", "Screen the market"]];
  else if (j.kind === "review") stages = [["data", "Price holdings"], ["analysts", "Position check-ins"], ["decision", "Portfolio review"]];
  else if (j.kind === "refresh") stages = [["data", "Live prices"], ["alerts", "New filings and insider buys"]];
  const last = stagesSeen[stagesSeen.length - 1];
  $("#stages").innerHTML = stages.map(([k, label]) => {
    const seen = stagesSeen.includes(k), isNow = k === last && running;
    const skipped = !seen && stagesSeen.length && stages.findIndex(s => s[0] === last) > stages.findIndex(s => s[0] === k);
    return `<li class="${isNow ? "now" : seen ? "done" : ""}"><span class="tick"></span><span>${esc(label)}${skipped ? " (skipped)" : ""}</span></li>`;
  }).join("");

  const logs = cur.filter(e => e.type === "log").slice(-5);
  $("#log").innerHTML = running ? logs.map(l => esc(l.message)).join("<br>") : "";

  const agents = new Map();
  cur.forEach(e => {
    if (!e.agent) return;
    const a = agents.get(e.agent) || { id: e.agent, label: e.label, group: e.group };
    if (e.type === "agent_start") Object.assign(a, { status: "running", model: e.model, web: e.web });
    if (e.type === "agent_done") Object.assign(a, { status: "done", text: e.text, seconds: e.seconds });
    if (e.type === "agent_error") Object.assign(a, { status: "error", text: e.error });
    agents.set(e.agent, a);
  });
  const group = g => [...agents.values()].filter(a => a.group === g);
  const card = a => `<details class="agent" data-id="${esc(a.id)}"><summary><span class="who">${esc(a.label)}</span>
    <span class="st ${a.status}">${a.status === "running" ? (a.web ? "reading + searching the web…" : "thinking…") : a.status === "error" ? "failed" : `${a.seconds}s`}</span></summary>
    <div class="body md">${a.text ? md(a.text) : ""}</div></details>`;
  const bubbles = list => `<div class="debate">${list.map(a => {
    const side = /^bull/.test(a.id) ? "bull" : /^bear/.test(a.id) ? "bear" : "neutral";
    return `<div class="bubble ${side} ${a.status === "running" ? "typing" : ""}"><div class="speaker">${esc(a.label)}</div>
      <div class="md">${a.status === "running" ? "is writing…" : md(a.text || "")}</div></div>`;
  }).join("")}</div>`;

  const open = new Set($$("#room details[open]").map(d => d.dataset.id));
  const sections = [];
  if (group("analysts").length) sections.push(`<h2>${j.kind === "review" ? "Position check-ins" : "Analyst team"}</h2>${group("analysts").map(card).join("")}`);
  if (group("debate").length) sections.push(`<h2>Bull vs bear</h2>${bubbles(group("debate"))}`);
  if (group("manager").length) sections.push(`<h2>Decisions</h2>${group("manager").map(card).join("")}`);
  if (group("risk").length) sections.push(`<h2>Trader and risk team</h2>${bubbles(group("risk"))}`);
  if (group("writer").length) sections.push(`<h2>Write-up</h2>${group("writer").map(card).join("")}`);
  $("#room").innerHTML = sections.join("");
  $$("#room details").forEach(d => open.has(d.dataset.id) && (d.open = true));
}

/* ---------------- Report ---------------- */

async function viewReport(id) {
  const r = await readJSON(`reports/${id}.json`);
  if (!r) throw new Error("This report isn't in your repo any more.");
  const v = r.verdict || {}, d = r.decision || {}, f = r.facts || {}, m = f.metrics || {}, pt = v.price_targets || {};
  const rating = d.final_rating || v.rating;
  setTitle(r.name || r.ticker, { back: true });
  const facts = [
    ["Market cap", money(f.market_cap)], ["Revenue YoY", signedPct(m.revenue_yoy_pct, false)], ["Gross margin", m.gross_margin_pct != null ? m.gross_margin_pct + "%" : "—"],
    ["Cash", money(m.cash_and_investments)], ["Analysts", f.analysts ?? "0"], ["Short interest", pct(f.short_pct)],
    ["Insider buys (6 mo)", money(f.insiders?.buy_value, 0)], ["Next earnings", f.next_earnings ? esc(String(f.next_earnings).slice(0, 10)) : "—"], ["Dilution (1 yr)", m.share_count_change_1y_pct != null ? m.share_count_change_1y_pct + "%" : "—"],
  ];
  view.innerHTML = `
    <div class="hero"><div><div class="ticker">${esc(r.ticker)}</div><div class="co">${esc(r.name || "")}${f.sector ? `, ${esc(f.sector)}` : ""}</div>
      <div class="price">${price(f.price)} <span class="faint">at research time</span></div></div>${gem(v.gem_score, rating, true)}</div>
    <div class="verdict">${ratingChip(rating)}${d.action ? `<span class="rating r-none">${esc(d.action)}${d.position_size_pct ? ` ${d.position_size_pct}% of portfolio` : ""}</span>` : ""}
      ${v.conviction ? `<span class="faint">${esc(v.conviction)} conviction</span>` : ""}</div>
    ${v.one_liner ? `<p class="oneliner">${esc(v.one_liner)}</p>` : ""}
    ${targetBar(f.price, pt)}
    <div class="row-actions">
      <a class="btn rh" href="${robinhood(r.ticker)}" target="_blank" rel="noopener">Open in Robinhood</a>
      <button class="btn quiet" id="ask">Ask about this</button>
      <button class="btn quiet" id="w">Watch</button>
      <button class="btn ghost" id="rerun">Re-run</button>
    </div>
    <dl class="facts">${facts.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join("")}</dl>
    <div class="seg" role="tablist">${[["dd", "The DD"], ["thesis", "Thesis"], ["plan", "Plan"], ["debate", "Debate"], ["analysts", "Analysts"], ["data", "Data"]]
      .map(([k, l], i) => `<button role="tab" data-tab="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div>
    <div id="tab"></div>
    <p class="faint" style="margin-top:28px">Generated ${esc((r.finished || r.created || "").replace("T", " ").slice(0, 16))} on your Claude plan (${esc(r.models?.quick || "")} / ${esc(r.models?.deep || "")}). Research, not financial advice.</p>
    <button class="btn danger small" id="del">Remove from list</button>`;

  const tabs = {
    dd: () => `<article class="md">${md(r.dd_markdown)}</article>`,
    thesis: () => `
      ${v.why_overlooked ? `<h3>Why it's overlooked</h3><p>${esc(v.why_overlooked)}</p>` : ""}
      ${list("Thesis", v.thesis_points)}${list("Key risks", v.key_risks)}
      ${v.catalysts?.length ? `<h3>Catalysts</h3><ul class="list">${v.catalysts.map(c => `<li style="padding:10px 0"><b>${esc(c.timing)}</b> <span class="rating ${c.impact === "high" ? "r-buy" : "r-none"}">${esc(c.impact)} impact</span><br>${esc(c.event)}</li>`).join("")}</ul>` : ""}
      ${list("What would prove it wrong", v.thesis_breakers)}
      <h3>Research manager's write-up</h3><div class="md">${md(r.research_manager)}</div>`,
    plan: () => `
      <dl class="facts"><div><dt>Action</dt><dd>${esc(d.action || "—")}</dd></div><div><dt>Size</dt><dd>${d.position_size_pct != null ? d.position_size_pct + "%" : "—"}</dd></div>
        <div><dt>Buy zone</dt><dd>${d.buy_zone_low ? `${price(d.buy_zone_low)}–${price(d.buy_zone_high)}` : "—"}</dd></div></dl>
      ${d.entry_plan ? `<h3>Entry</h3><p>${esc(d.entry_plan)}</p>` : ""}
      ${d.invalidation ? `<h3>Invalidation</h3><p>${esc(d.invalidation)}</p>` : ""}
      ${list("Review it again when", d.review_triggers)}
      ${d.time_horizon ? `<p class="muted">Horizon: ${esc(d.time_horizon)}</p>` : ""}
      <h3>Portfolio manager</h3><div class="md">${md(r.portfolio_manager)}</div>
      ${r.trader_plan ? `<h3>Trader's plan</h3><div class="md">${md(r.trader_plan)}</div>` : ""}
      ${r.risk_debate?.length ? `<h3>Risk team</h3><div class="debate">${r.risk_debate.map(x => `<div class="bubble neutral"><div class="speaker">${esc(x.speaker)}</div><div class="md">${md(x.text)}</div></div>`).join("")}</div>` : ""}`,
    debate: () => `<div class="debate">${(r.debate || []).map(x => `<div class="bubble ${x.speaker.toLowerCase()}"><div class="speaker">${esc(x.speaker)}, round ${x.round}</div><div class="md">${md(x.text)}</div></div>`).join("")}</div>`,
    analysts: () => Object.entries(r.analyst_reports || {}).map(([k, t]) => `<details class="agent"><summary><span class="who">${esc(ANALYST_NAMES[k] || k)}</span><span class="st">${signalOf(t)}</span></summary><div class="body md">${md(t)}</div></details>`).join(""),
    data: () => `
      <h3>Price, past year</h3>${lineChart(f.weekly_closes) || "<p class='muted'>No price history.</p>"}
      <h3>Quarterly revenue</h3>${barChart(f.quarterly_revenue) || "<p class='muted'>No XBRL revenue.</p>"}
      ${f.insiders ? `<h3>Insiders, last 6 months</h3><p>${f.insiders.buy_count} open-market buys (${money(f.insiders.buy_value, 0)}) by ${f.insiders.distinct_buyers} insider(s)${f.insiders.cluster_buying ? ", including a cluster" : ""}; ${f.insiders.sell_count} sales (${money(f.insiders.sell_value, 0)}).</p>` : ""}
      <h3>Computed metrics</h3><dl class="facts">${Object.entries(m).map(([k, x]) => `<div><dt>${esc(k.replace(/_/g, " "))}</dt><dd>${typeof x === "number" && Math.abs(x) > 1e5 ? money(x) : esc(x)}</dd></div>`).join("")}</dl>
      ${f.summary ? `<h3>Company</h3><p class="small">${esc(f.summary)}</p>` : ""}
      <h3>Sources</h3><ul>${(r.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>
      ${r.data_errors?.length ? `<h3>Data gaps</h3><ul class="faint">${r.data_errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}`,
  };
  const show = k => { $$(".seg button").forEach(b => b.classList.toggle("on", b.dataset.tab === k)); $("#tab").innerHTML = tabs[k](); };
  $$(".seg button").forEach(b => (b.onclick = () => show(b.dataset.tab)));
  show("dd");
  $("#ask").onclick = () => askSheet({ report_id: r.id || id, title: `Ask about ${r.ticker}` });
  $("#w").onclick = () => watch(r.ticker);
  $("#rerun").onclick = () => startDD(r.ticker);
  $("#del").onclick = async () => {
    if (!confirm(`Remove this ${r.ticker} report from your list?`)) return;
    await updateJSON("reports/index.json", idx => idx.filter(x => x.id !== id), [], `app: remove report ${id}`);
    location.hash = "#/research";
  };
}

const ANALYST_NAMES = { filings: "Filings analyst", financials: "Financials analyst", earnings: "Earnings call analyst", insiders: "Insider & ownership analyst", news: "News & catalyst analyst", market: "Market & technicals analyst" };
const list = (title, items) => (items?.length ? `<h3>${esc(title)}</h3><ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
function signalOf(t) {
  const m = /Signal\s*\n+\s*\**\s*(Bullish|Neutral|Bearish)/i.exec(t || "");
  return m ? `<span class="${/bull/i.test(m[1]) ? "up" : /bear/i.test(m[1]) ? "down" : ""}">${m[1]}</span>` : "";
}

function targetBar(now, pt) {
  if (!pt || pt.base == null || !now) return "";
  const vals = [pt.bear, pt.base, pt.bull, now].filter(x => x != null);
  const lo = Math.min(...vals) * 0.92, hi = Math.max(...vals) * 1.05, pos = x => ((x - lo) / (hi - lo)) * 100;
  const mk = (x, cls) => `<div class="mark ${cls}" style="left:${pos(x)}%"><i></i></div>`;
  const up = Math.round((pt.base / now - 1) * 100);
  const cell = (label, x, cls) => `<div><dt>${label}</dt><dd class="${cls}">${price(x)}</dd></div>`;
  return `<div class="targets"><span class="small muted">${pt.horizon_months || 12}-month price targets. Base case ${up >= 0 ? "+" : ""}${up}% from the research-time price.</span>
    <div class="bar"><div class="track"></div>${mk(pt.bear, "bear")}${mk(pt.base, "base")}${mk(pt.bull, "bull")}${mk(now, "now")}</div>
    <dl class="facts tgt">${cell("Bear", pt.bear, "down")}${cell("Base", pt.base, "")}${cell("Bull", pt.bull, "up")}${cell("Then", now, "")}</dl></div>`;
}

/* ---------------- Ask (copilot chat) ---------------- */

function askSheet(ctx) {
  const history = [];
  const sh = openSheet(`<h2 style="margin-top:4px">${esc(ctx.title)}</h2>
    <div class="chat" id="chat"><div class="ai small muted">Ask anything — "What's the biggest risk?", "How does this compare to its competitors?", "Should I add at this price given my portfolio?" Each answer takes about a minute while GitHub starts a runner.</div></div>
    <form class="composer" id="cmp"><input type="text" id="msg" placeholder="Your question" autocomplete="off" required><button class="btn">Ask</button></form>`);
  $("#cmp", sh).addEventListener("submit", async e => {
    e.preventDefault();
    const q = $("#msg", sh).value.trim();
    if (!q) return;
    $("#msg", sh).value = "";
    const chat = $("#chat", sh);
    const pid = `p${Date.now()}`;
    chat.insertAdjacentHTML("beforeend", `<div class="me">${esc(q)}</div><div class="ai muted" id="${pid}">Starting a runner…</div>`);
    sh.scrollTop = sh.scrollHeight;
    try {
      const { title, ...params } = ctx;
      const id = await dispatch("ask", { question: q, history, ...params });
      let j;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, i < 6 ? 6000 : 4000));
        if ($("#sheet").hidden) return;
        j = await getJob(id);
        const el = document.getElementById(pid);
        if (el && j.status === "running") el.textContent = "Thinking…";
        if (j.status === "done" || j.status === "error") break;
      }
      if (j?.status !== "done") throw new Error(j?.error || "No answer yet. Check Research → Recent runs.");
      history.push({ role: "investor", content: q }, { role: "copilot", content: j.result.answer });
      document.getElementById(pid).outerHTML = `<div class="ai md">${md(j.result.answer)}</div>`;
    } catch (err) { const el = document.getElementById(pid); if (el) el.outerHTML = `<div class="ai down">${esc(err.message)}</div>`; }
    sh.scrollTop = sh.scrollHeight;
  });
  $("#msg", sh).focus();
}

/* ---------------- Portfolio ---------------- */

const EMPTY_PF = { holdings: [], cash: 0, watchlist: [] };
const savePortfolio = (fn, msg) => updateJSON("portfolio.json", p => fn({ ...EMPTY_PF, ...p }), EMPTY_PF, msg);

async function viewPortfolio() {
  setTitle("Portfolio");
  const [pf0, pr, review, al, jobs] = await Promise.all([readJSON("portfolio.json", EMPTY_PF), readJSON("prices.json", { prices: {} }),
    readJSON("reviews/latest.json", {}), unseenAlerts(), activeJobs()]);
  const pf = { ...EMPTY_PF, ...pf0 }, prices = pr.prices || {};
  const holdings = pf.holdings.map(h => {
    const p = prices[h.ticker]?.price;
    const value = (p || h.avg_cost || 0) * h.shares;
    return { ...h, price: p, value, gain_pct: p && h.avg_cost ? (p / h.avg_cost - 1) * 100 : null };
  });
  const total = holdings.reduce((s, h) => s + h.value, 0) + Number(pf.cash || 0);
  holdings.forEach(h => (h.weight_pct = total ? Math.round((h.value / total) * 1000) / 10 : 0));
  holdings.sort((a, b) => b.value - a.value);
  const reviewing = jobs.some(j => j.kind === "review"), refreshing = jobs.some(j => j.kind === "refresh");
  const ck = Object.fromEntries((review.checkins || []).map(c => [c.ticker, c]));
  const statusClass = s => ({ "Thesis intact": "status-intact", "Watch closely": "status-watch", "Thesis weakening": "status-weak", "Thesis broken": "status-broken" }[s] || "muted");

  view.innerHTML = `${activeJobBanners(jobs.filter(j => j.kind !== "refresh"))}
    <p class="faint">Your Robinhood companion. You enter your holdings here — GemHunter never connects to your brokerage account.</p>
    <div class="total">${money(total)}</div>
    <p class="muted small">Cash ${money(pf.cash)} ${total ? `(${Math.round((pf.cash / total) * 100)}%)` : ""} <button class="btn ghost small" id="cash">Edit cash</button><br>
      ${pr.updated ? `Prices as of ${when(pr.updated)}` : "No prices yet"}${refreshing ? ", refreshing now" : ""}</p>
    <div class="row-actions">
      <button class="btn" id="review" ${reviewing || !holdings.length ? "disabled" : ""}>Review my portfolio</button>
      <button class="btn quiet" id="add">Add holding</button>
      <button class="btn quiet" id="import">Paste holdings</button>
    </div>
    ${holdings.length ? `<ul class="list">${holdings.map(h => {
      const c = ck[h.ticker];
      return `<li><div class="holding">
        <div><span class="ticker" style="font-size:20px">${esc(h.ticker)}</span> <span class="small muted">${h.shares} sh${h.avg_cost ? ` @ ${price(h.avg_cost)}` : ""}</span>
          ${c ? `<div class="small ${statusClass(c.status)}">${esc(c.status)}${c.action ? `, ${esc(c.action)}` : ""}</div>` : ""}</div>
        <div style="text-align:right"><b>${money(h.value)}</b><br><span class="small">${h.gain_pct != null ? signedPct(h.gain_pct, false) : ""} ${h.weight_pct}%</span></div>
        <div style="grid-column:1/-1"><div class="weight"><i style="width:${Math.min(100, h.weight_pct)}%"></i></div>
          <div class="row-actions" style="margin:8px 0 0">
            <a class="btn rh small" href="${robinhood(h.ticker)}" target="_blank" rel="noopener">Robinhood</a>
            <button class="btn quiet small" data-dd="${esc(h.ticker)}">Deep DD</button>
            <button class="btn ghost small" data-edit="${esc(h.ticker)}">Edit</button></div></div>
      </div></li>`;
    }).join("")}</ul>` : `<div class="empty"><h2>Add what you own</h2><p>Enter your Robinhood positions (ticker, shares, average cost) so the copilot can size ideas for your portfolio, check your theses and flag new filings.</p></div>`}

    ${review.review ? `<h2>Copilot review <span class="faint">${when(review.created)}</span></h2>
      ${review.actions?.length ? `<ul class="list">${review.actions.map(a => `<li style="padding:11px 0"><span class="ticker" style="font-size:18px">${esc(a.ticker)}</span> ${ratingChip(a.action)} <span class="faint">${esc(a.priority)} priority</span><br><span class="small">${esc(a.reason)}</span></li>`).join("")}</ul>` : ""}
      ${review.risk_flags?.length ? `<h3>Risk flags</h3><ul>${review.risk_flags.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <details class="agent"><summary><span class="who">Full review</span><span class="st">read</span></summary><div class="body md">${md(review.review)}</div></details>
      ${(review.checkins || []).map(c => `<details class="agent"><summary><span class="who">${esc(c.ticker)} check-in</span><span class="st ${statusClass(c.status)}">${esc(c.status || "")}</span></summary><div class="body md">${md(c.text)}</div></details>`).join("")}
      <div class="row-actions"><button class="btn quiet" id="askpf">Ask the copilot</button></div>` : ""}

    <h2>Alerts</h2>
    ${al.alerts.length ? `<ul class="list">${al.alerts.slice(0, 25).map(a => `<li><a class="rowlink" href="${esc(a.url)}" target="_blank" rel="noopener">
      <b>${esc(a.ticker)}</b> ${(a.created || "") > (localStorage.getItem("gh_alerts_seen") || "") ? `<span class="rating r-buy">new</span>` : ""} <span class="faint">${esc(a.date || "")}</span><br><span class="small">${esc(a.title)}</span></a></li>`).join("")}</ul>`
      : `<p class="muted small">New 8-Ks, 10-Qs, 13Ds and insider purchases for your holdings and watchlist show up here. They're checked each time you open the app.</p>`}
    <div class="row-actions"><button class="btn quiet small" id="refresh" ${refreshing ? "disabled" : ""}>Refresh prices and filings</button></div>

    <h2>Watchlist</h2>
    ${pf.watchlist.length ? `<ul class="list">${pf.watchlist.map(w => {
      const p = prices[w.ticker];
      return `<li style="display:flex;align-items:center;gap:8px;padding:10px 0"><span style="flex:1"><span class="ticker" style="font-size:18px">${esc(w.ticker)}</span> <span class="small muted">${p?.price ? price(p.price) : ""}</span></span>
      ${sparkline(p?.spark)}
      <a class="btn rh small" href="${robinhood(w.ticker)}" target="_blank" rel="noopener">Robinhood</a>
      <button class="btn quiet small" data-dd="${esc(w.ticker)}">DD</button>
      <button class="btn ghost small" data-unwatch="${esc(w.ticker)}" aria-label="Remove ${esc(w.ticker)}">✕</button></li>`;
    }).join("")}</ul>` : `<p class="muted small">Tap Watch on any gem or report to track it here.</p>`}`;

  if (al.alerts.length) localStorage.setItem("gh_alerts_seen", al.alerts[0].created || "");
  $("#review").onclick = async () => { location.hash = `#/job/${await dispatch("review", {})}`; };
  $("#refresh").onclick = async () => { await dispatch("refresh", {}); toast("Refreshing — takes about two minutes"); viewPortfolio(); };
  $("#add").onclick = () => holdingSheet();
  $("#import").onclick = importSheet;
  $("#cash").onclick = async () => {
    const v = prompt("Cash available (USD)", pf.cash);
    if (v != null && !isNaN(parseFloat(v))) { await savePortfolio(p => ({ ...p, cash: parseFloat(v) }), "app: cash"); viewPortfolio(); }
  };
  const askpf = $("#askpf");
  if (askpf) askpf.onclick = () => askSheet({ scope: "portfolio", title: "Ask the copilot" });
  $$("[data-dd]").forEach(b => (b.onclick = () => startDD(b.dataset.dd)));
  $$("[data-edit]").forEach(b => (b.onclick = () => holdingSheet(pf.holdings.find(h => h.ticker === b.dataset.edit))));
  $$("[data-unwatch]").forEach(b => (b.onclick = async () => {
    await savePortfolio(p => ({ ...p, watchlist: p.watchlist.filter(w => w.ticker !== b.dataset.unwatch) }), "app: unwatch");
    viewPortfolio();
  }));
  if (jobs.length) state.pollers.push(setTimeout(() => location.hash === "#/portfolio" && viewPortfolio(), 20000));
}

const cleanTicker = t => String(t || "").trim().toUpperCase().replace(/^\$/, "").replace(/[-/]/g, ".");

function holdingSheet(h) {
  const sh = openSheet(`<h2 style="margin-top:4px">${h ? `Edit ${esc(h.ticker)}` : "Add a holding"}</h2>
    <form id="hf">
      <label class="field"><span>Ticker</span><input type="text" name="ticker" value="${esc(h?.ticker || "")}" ${h ? "readonly" : ""} required autocapitalize="characters"></label>
      <div class="grid2"><label class="field"><span>Shares</span><input type="number" step="any" name="shares" value="${h?.shares ?? ""}" required></label>
      <label class="field"><span>Average cost</span><input type="number" step="any" name="avg_cost" value="${h?.avg_cost ?? ""}"></label></div>
      <label class="field"><span>Why you own it</span><textarea name="thesis" placeholder="Optional. The copilot checks this thesis against new filings and news.">${esc(h?.thesis || "")}</textarea></label>
      <div class="row-actions"><button class="btn">Save holding</button>${h ? `<button type="button" class="btn danger" id="rm">Remove</button>` : ""}</div>
    </form>`);
  $("#hf", sh).addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const t = cleanTicker(fd.get("ticker"));
    const row = { ticker: t, shares: parseFloat(fd.get("shares")), avg_cost: fd.get("avg_cost") ? parseFloat(fd.get("avg_cost")) : null, thesis: fd.get("thesis") || "" };
    await savePortfolio(p => ({ ...p, holdings: [...p.holdings.filter(x => x.ticker !== t), row] }), `app: holding ${t}`);
    closeSheet(); toast("Holding saved"); viewPortfolio();
  });
  const rm = $("#rm", sh);
  if (rm) rm.onclick = async () => { await savePortfolio(p => ({ ...p, holdings: p.holdings.filter(x => x.ticker !== h.ticker) }), `app: remove ${h.ticker}`); closeSheet(); viewPortfolio(); };
}

function importSheet() {
  const sh = openSheet(`<h2 style="margin-top:4px">Paste holdings</h2>
    <p class="muted small">One position per line: ticker, shares, average cost. Copy them from Robinhood's Investing screen or a statement.</p>
    <textarea id="txt" placeholder="SOFI 120 7.85&#10;HIMS 40 18.20&#10;RKLB, 75, 6.10"></textarea>
    <div class="row-actions"><button class="btn" id="go">Import holdings</button></div>`);
  $("#go", sh).onclick = async () => {
    const rows = [];
    for (const line of $("#txt", sh).value.split("\n")) {
      const parts = line.trim().split(/[,\t ]+/).filter(Boolean);
      if (parts.length < 2 || !/^\$?[A-Za-z][A-Za-z0-9.\-]{0,7}$/.test(parts[0])) continue;
      const nums = parts.slice(1).map(x => parseFloat(x.replace(/[$,]/g, ""))).filter(x => !isNaN(x));
      if (nums.length) rows.push({ ticker: cleanTicker(parts[0]), shares: nums[0], avg_cost: nums[1] ?? null, thesis: "" });
    }
    if (!rows.length) return toast("No lines matched “TICKER SHARES COST”");
    await savePortfolio(p => {
      const keep = p.holdings.filter(x => !rows.some(r => r.ticker === x.ticker));
      return { ...p, holdings: [...keep, ...rows.map(r => ({ ...r, thesis: p.holdings.find(x => x.ticker === r.ticker)?.thesis || "" }))] };
    }, "app: import holdings");
    closeSheet();
    toast(`Imported ${rows.map(r => r.ticker).join(", ")}`);
    await dispatch("refresh", {}).catch(() => {});
    viewPortfolio();
  };
}

/* ---------------- Settings ---------------- */

const DEFAULTS = { llm_backend: "claude_code", quick_model: "sonnet", deep_model: "opus", analyst_web_search: true, lite_mode: false,
  debate_rounds: 2, max_parallel_agents: 3, min_market_cap: 50e6, max_market_cap: 10e9, min_price: 1, min_dollar_volume: 250000,
  stage2_size: 60, shortlist_size: 5, include_pre_revenue: false, sec_user_agent: "" };

async function viewSettings() {
  setTitle("Settings");
  const s = { ...DEFAULTS, ...(await readJSON("settings.json", {})) };
  const c = cfg();
  const sel = (name, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[name]) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const num = (name, step = "any") => `<input type="number" step="${step}" name="${name}" value="${s[name]}">`;
  const sw = (name, label, help = "") => `<label class="switch"><span>${label}${help ? `<br><span class="faint">${help}</span>` : ""}</span><input type="checkbox" name="${name}" ${s[name] ? "checked" : ""}></label>`;

  view.innerHTML = `<form id="sf">
    <h2>AI research team</h2>
    <label class="field"><span>Runs on</span>${sel("llm_backend", [["claude_code", "My Claude plan"], ["mock", "Demo mode (no AI)"]])}
      <small>Uses the CLAUDE_CODE_OAUTH_TOKEN secret in your GemHunter-data repo.</small></label>
    <div class="grid2">
      <label class="field"><span>Analyst model</span>${sel("quick_model", [["haiku", "Haiku (fastest)"], ["sonnet", "Sonnet"], ["opus", "Opus"]])}</label>
      <label class="field"><span>Decision model</span>${sel("deep_model", [["sonnet", "Sonnet"], ["opus", "Opus"], ["fable", "Fable"]])}</label>
    </div>
    ${sw("analyst_web_search", "Let analysts search the web", "News and earnings-call analysts look up transcripts and recent news")}
    ${sw("lite_mode", "Lite mode", "One debate round, no risk team, analyst model everywhere — about half the usage")}
    <div class="grid2"><label class="field"><span>Debate rounds</span>${num("debate_rounds", 1)}</label>
      <label class="field"><span>Agents at once</span>${num("max_parallel_agents", 1)}</label></div>

    <h2>Screener</h2>
    <div class="grid2">
      <label class="field"><span>Min market cap ($)</span>${num("min_market_cap")}</label>
      <label class="field"><span>Max market cap ($)</span>${num("max_market_cap")}</label>
      <label class="field"><span>Min share price ($)</span>${num("min_price")}</label>
      <label class="field"><span>Min daily $ volume</span>${num("min_dollar_volume")}</label>
      <label class="field"><span>Stocks to enrich</span>${num("stage2_size", 1)}</label>
      <label class="field"><span>Stocks to fully research</span>${num("shortlist_size", 1)}<small>Each one is about 15 agent calls and 10 GitHub minutes</small></label>
    </div>
    ${sw("include_pre_revenue", "Include pre-revenue companies", "Biotechs and early-stage companies with no reported sales")}

    <h2>SEC access</h2>
    <label class="field"><span>Your name and email</span><input type="text" name="sec_user_agent" value="${esc(s.sec_user_agent)}" placeholder="Jane Smith jane@gmail.com">
      <small>SEC requires every request to say who is asking. It's only sent to sec.gov.</small></label>

    <div class="row-actions"><button class="btn block">Save settings</button></div>
  </form>

  <h2>Connection</h2>
  <p class="small muted">Data repo <b>${esc(c.repo)}</b> (${esc(c.branch)} branch).</p>
  <div class="row-actions">
    <button class="btn quiet" id="test">Test my Claude plan</button>
    <a class="btn ghost" href="https://github.com/${esc(c.repo)}/actions" target="_blank" rel="noopener">GitHub runs</a>
    <button class="btn ghost" id="out">Disconnect</button>
  </div>
  <p class="faint">GemHunter is a research tool, not a licensed advisor. It never connects to or trades in your Robinhood account.</p>`;

  $("#sf").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target), body = {};
    $$("#sf [name]").forEach(el => {
      const v = el.type === "checkbox" ? el.checked : fd.get(el.name);
      body[el.name] = el.type === "number" ? Number(v) : v;
    });
    await updateJSON("settings.json", cur => ({ ...cur, ...body }), {}, "app: settings");
    toast("Settings saved");
  });
  $("#test").onclick = async () => { location.hash = `#/job/${await dispatch("ask", { question: "Reply with one short sentence confirming GemHunter can reach Claude." })}`; };
  $("#out").onclick = () => { if (confirm("Disconnect this device from GitHub?")) { localStorage.removeItem("gh_cfg"); showLogin(); } };
}

/* ---------------- boot ---------------- */

(function boot() {
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!cfg()) return showLogin();
  route();
  autoRefresh();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && autoRefresh());
})();
