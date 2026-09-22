// Self-contained HTML test report. No external assets; works offline and in light or dark mode.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtK = (n) => (n == null ? 'n/a' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const fmtUSD = (n) => (n == null ? 'n/a' : `$${n.toFixed(3)}`);
const fmtS = (ms) => (ms == null ? 'n/a' : `${Math.round(ms / 1000)}s`);

// Model families keep a fixed colour wherever they appear (colour follows the entity).
const FAMILY = [
  { re: /sonnet|sol|terra/i, label: 'mid tier (Sonnet / Sol)', slot: 1 },
  { re: /opus|astra/i, label: 'top tier (Opus / Astra)', slot: 2 },
  { re: /haiku|luna|mini/i, label: 'fast tier (Haiku / Luna)', slot: 3 },
];
const family = (model) => FAMILY.find((f) => f.re.test(model)) || { label: 'other', slot: 4 };
export const cheapShare = (byModel) => {
  const tot = Object.values(byModel || {}).reduce((a, m) => a + m.input + m.output, 0);
  if (!tot) return null;
  const cheap = Object.entries(byModel).filter(([k]) => family(k).slot === 3).reduce((a, [, m]) => a + m.input + m.output, 0);
  return cheap / tot;
};

const badge = (status) => {
  const map = { pass: ['ok', '✓ pass'], fail: ['bad', '✕ fail'], error: ['bad', '! error'], skip: ['muted', '– skip'], warn: ['warn', '△ warn'], na: ['muted', '– n/a'] };
  const [cls, label] = map[status] || ['muted', status];
  return `<span class="badge ${cls}">${label}</span>`;
};

function tile(label, value, sub, status) {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div><div class="tile-sub">${status ? badge(status) + ' ' : ''}${esc(sub || '')}</div></div>`;
}

function budgetSection(budget) {
  const max = Math.max(...budget.flatMap((b) => b.parts.map((p) => Math.max(p.tokens, p.budget))));
  const rows = budget.flatMap((b) => b.parts.map((p) => {
    const w = (p.tokens / max) * 100;
    const bw = (p.budget / max) * 100;
    return `<div class="bar-row" title="${esc(`${b.skill}/${p.file}: ~${p.tokens} tokens, budget ${p.budget}`)}">
      <div class="bar-label"><span class="mono">${esc(b.skill)}/${esc(p.file)}</span></div>
      <div class="bar-track"><div class="bar ${p.ok ? '' : 'over'}" style="width:${w.toFixed(1)}%"></div><div class="bar-limit" style="left:${bw.toFixed(1)}%"></div></div>
      <div class="bar-value">~${p.tokens}<span class="muted"> / ${p.budget}</span> ${p.ok ? '' : badge('fail')}</div></div>`;
  }));
  return `<section><h2>Prompt budgets</h2><p class="lede">Estimated tokens each skill puts in context. SKILL.md is what the orchestrating agent carries; the other files are handed to subagents. The tick marks the budget.</p><div class="bars">${rows.join('')}</div></section>`;
}

function unitSection(unit) {
  if (!unit) return '<section><h2>Deterministic tests</h2><p class="muted">Skipped (--no-unit).</p></section>';
  const groups = {};
  for (const t of unit.tests) (groups[t.file] ||= []).push(t);
  const body = Object.entries(groups).map(([file, ts]) => {
    const fails = ts.filter((t) => t.status === 'fail').length;
    return `<details ${fails ? 'open' : ''}><summary><span class="mono">${esc(file)}</span> ${badge(fails ? 'fail' : 'pass')} <span class="muted">${ts.length - fails}/${ts.length}</span></summary>
      <table><thead><tr><th>Test</th><th>Result</th><th class="num">Time</th></tr></thead><tbody>
      ${ts.map((t) => `<tr><td>${esc(t.name)}${t.error ? `<pre class="err">${esc(t.error)}</pre>` : ''}</td><td>${badge(t.status)}</td><td class="num">${t.durationMs}ms</td></tr>`).join('')}
      </tbody></table></details>`;
  }).join('');
  return `<section><h2>Deterministic tests</h2><p class="lede">Script behaviour, schemas and repo conventions. Free to run, run on every change.</p>${body}</section>`;
}

function modelBar(byModel) {
  const entries = Object.entries(byModel || {}).map(([k, m]) => ({ k, f: family(k), t: m.input + m.output, m })).filter((e) => e.t > 0).sort((a, b) => a.f.slot - b.f.slot);
  const tot = entries.reduce((a, e) => a + e.t, 0);
  if (!tot) return '<span class="muted">no token data</span>';
  return `<div class="stack">${entries.map((e) => `<div class="seg s${e.f.slot}" style="flex:${e.t}" title="${esc(`${e.k}: ${fmtK(e.m.input)} in, ${fmtK(e.m.output)} out${e.m.costUSD != null ? `, ${fmtUSD(e.m.costUSD)}` : ''}`)}"></div>`).join('')}</div>
    <div class="stack-legend">${entries.map((e) => `<span><i class="dot s${e.f.slot}"></i>${esc(e.k)} <span class="muted">${Math.round((e.t / tot) * 100)}%</span></span>`).join('')}</div>`;
}

function liveSection(r) {
  if (!r.liveRequested) {
    return `<section><h2>Live evals</h2><p class="lede">Not run. Live evals drive a real agent CLI against fixtures and grade what it leaves behind. They cost tokens, so they are opt-in:</p><pre class="cmd">npm run eval:live            # every installed agent CLI
npm run eval:live -- --agent claude --case sn-login --repeat 3</pre></section>`;
  }
  const skipped = r.liveSkipped.length ? `<p class="muted">Skipped: ${esc(r.liveSkipped.join('; '))}</p>` : '';
  if (!r.live.length) return `<section><h2>Live evals</h2>${skipped}<p class="muted">No cases ran.</p></section>`;
  const cards = r.live.map((l) => {
    const m = l.metrics;
    const share = cheapShare(m.byModel);
    const rows = l.assertions.map((a) => {
      const st = a.pass === null ? 'na' : a.pass ? 'pass' : a.soft ? 'warn' : 'fail';
      return `<tr><td>${esc(a.name)}</td><td>${badge(st)}</td><td class="muted">${esc(a.detail)}</td></tr>`;
    }).join('');
    return `<article class="card">
      <header><div><h3>${esc(l.case)} <span class="muted">· ${esc(l.agent)}${l.repeat ? ` #${l.repeat}` : ''}</span></h3><p class="muted">${esc(l.description || '')}</p></div>${badge(l.status)}</header>
      ${l.error ? `<pre class="err">${esc(l.error)}</pre>` : ''}
      <div class="metrics">
        <div><span class="k">Cost</span><span class="v">${fmtUSD(m.costUSD)}</span></div>
        <div><span class="k">Time</span><span class="v">${fmtS(m.durationMs)}</span></div>
        <div><span class="k">Turns</span><span class="v">${m.turns ?? 'n/a'}</span></div>
        <div><span class="k">Tokens in / out</span><span class="v">${fmtK(m.inputTokens)} / ${fmtK(m.outputTokens)}</span></div>
        <div><span class="k">Orchestrator tool calls</span><span class="v">${m.mainToolCalls}</span></div>
        <div><span class="k">Delegated share</span><span class="v">${m.delegatedShare == null ? 'n/a' : `${Math.round(m.delegatedShare * 100)}%`}</span></div>
        <div><span class="k">Fast-tier share</span><span class="v">${share == null ? 'n/a' : `${Math.round(share * 100)}%`}</span></div>
      </div>
      <div class="sub-h">Tokens by model</div>${modelBar(m.byModel)}
      <table><thead><tr><th>Assertion</th><th>Result</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>
      ${l.finalText ? `<details><summary>Agent's final message</summary><pre class="final">${esc(l.finalText)}</pre></details>` : ''}
    </article>`;
  }).join('');
  return `<section><h2>Live evals</h2><p class="lede">Real agent runs on fixture repos with the skill installed. Soft assertions warn without failing. Delegated share is the fraction of tokens spent inside subagents rather than the orchestrator; fast-tier share is the fraction processed by the cheapest model class. Both show whether the main agent kept its own context for what matters.</p>${skipped}<div class="cards">${cards}</div></section>`;
}

function spark(values, { label, fmt = (v) => v, max }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
  if (pts.length < 2) return `<div class="spark"><div class="spark-label">${esc(label)}</div><div class="muted">needs 2+ runs</div></div>`;
  const W = 240, H = 48, P = 4;
  const hi = max ?? Math.max(...pts.map((p) => p.v), 1e-9);
  const x = (i) => P + (i / (values.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / hi) * (H - 2 * P);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts.at(-1);
  return `<div class="spark"><div class="spark-label">${esc(label)} <strong>${esc(fmt(last.v))}</strong></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(label)} trend"><path d="${d}" class="spark-line"/>
    ${pts.map((p) => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="6" class="hit"><title>${esc(`${fmt(p.v)}`)}</title></circle>`).join('')}
    <circle cx="${x(last.i).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3" class="spark-dot"/></svg></div>`;
}

function historySection(history) {
  const h = history.slice(-20);
  const unitRate = h.map((x) => (x.unitPass == null ? null : x.unitPass / Math.max(1, x.unitPass + x.unitFail)));
  const liveRate = h.map((x) => (x.liveTotal ? x.livePass / x.liveTotal : null));
  const cost = h.map((x) => (x.liveTotal ? x.liveCost : null));
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rows = h.slice().reverse().slice(0, 10).map((x) => `<tr><td class="mono">${esc(x.runId)}</td><td class="mono">${esc(x.commit || '')}</td><td class="num">${x.unitPass ?? '–'}/${x.unitPass == null ? '–' : x.unitPass + x.unitFail}</td><td class="num">${x.liveTotal ? `${x.livePass}/${x.liveTotal}` : '–'}</td><td class="num">${x.liveTotal ? fmtUSD(x.liveCost) : '–'}</td><td class="num">${Object.entries(x.skillTokens || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</td></tr>`).join('');
  return `<section><h2>History</h2><p class="lede">Last ${h.length} runs. Use it to see whether a SKILL.md edit made things better, cheaper or leaner.</p>
    <div class="sparks">${spark(unitRate, { label: 'Unit pass rate', fmt: pct, max: 1 })}${spark(liveRate, { label: 'Live pass rate', fmt: pct, max: 1 })}${spark(cost, { label: 'Live cost per run', fmt: (v) => fmtUSD(v) })}</div>
    <table><thead><tr><th>Run</th><th>Commit</th><th class="num">Unit</th><th class="num">Live</th><th class="num">Cost</th><th class="num">SKILL.md tokens</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export function renderHtml(r, history = []) {
  const u = r.unit;
  const liveN = r.live.length;
  const livePass = r.live.filter((l) => l.status === 'pass').length;
  const liveCost = r.live.reduce((a, l) => a + (l.metrics.costUSD || 0), 0);
  const overBudget = r.budget.filter((b) => !b.ok).length;
  const shares = r.live.map((l) => cheapShare(l.metrics.byModel)).filter((s) => s != null);
  const deleg = r.live.map((l) => l.metrics.delegatedShare).filter((s) => s != null);
  const avgPct = (xs) => `${Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100)}%`;
  const tiles = [
    tile('Deterministic tests', u ? `${u.pass}<span class="muted">/${u.pass + u.fail}</span>` : '–', u ? `${u.fail} failing` : 'skipped', u ? (u.fail ? 'fail' : 'pass') : 'skip'),
    tile('Live evals', liveN ? `${livePass}<span class="muted">/${liveN}</span>` : '–', liveN ? `${liveN - livePass} not passing` : 'not run', liveN ? (livePass === liveN ? 'pass' : 'fail') : 'skip'),
    tile('Live cost', liveN ? fmtUSD(liveCost) : '–', liveN ? `${fmtUSD(liveCost / liveN)} per run` : 'not run'),
    tile('Delegated share', deleg.length ? avgPct(deleg) : '–', 'avg tokens spent in subagents'),
    tile('Fast-tier share', shares.length ? avgPct(shares) : '–', 'avg tokens on the cheapest model'),
    tile('Prompt budgets', `${r.budget.length - overBudget}<span class="muted">/${r.budget.length}</span>`, overBudget ? `${overBudget} skill over budget` : 'all skills lean', overBudget ? 'fail' : 'pass'),
  ].join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>lunar-skills test report</title>
<style>
:root{color-scheme:light;--bg:#f6f6f4;--surface:#fcfcfb;--line:#e4e3de;--text:#0b0b0b;--text2:#52514e;--muted:#7a7974;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--ok:#0f7a3d;--okbg:#e3f4ea;--bad:#b42318;--badbg:#fde8e7;--warn:#8a5a00;--warnbg:#fdf1d8;--code:#f0efeb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#121211;--surface:#1a1a19;--line:#2e2d2a;--text:#fff;--text2:#c3c2b7;--muted:#8f8e86;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--ok:#5fd08f;--okbg:#15301f;--bad:#ff8a80;--badbg:#3a1714;--warn:#f2c14e;--warnbg:#33290f;--code:#232321}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#121211;--surface:#1a1a19;--line:#2e2d2a;--text:#fff;--text2:#c3c2b7;--muted:#8f8e86;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--ok:#5fd08f;--okbg:#15301f;--bad:#ff8a80;--badbg:#3a1714;--warn:#f2c14e;--warnbg:#33290f;--code:#232321}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.01em}h2{font-size:19px;margin:0 0 4px}h3{font-size:16px;margin:0}
.lede{color:var(--text2);margin:0 0 16px;max-width:75ch}.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
section{margin-top:40px}
.env{color:var(--muted);font-size:13px;margin-bottom:24px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tile-label{color:var(--text2);font-size:13px}.tile-value{font-size:30px;font-weight:650;font-variant-numeric:tabular-nums;margin:2px 0}.tile-sub{font-size:13px;color:var(--text2)}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap}
.badge.ok{color:var(--ok);background:var(--okbg)}.badge.bad{color:var(--bad);background:var(--badbg)}.badge.warn{color:var(--warn);background:var(--warnbg)}.badge.muted{color:var(--muted);background:var(--code)}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--text2);font-weight:600;font-size:13px}.num{text-align:right;font-variant-numeric:tabular-nums}
details{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:8px}summary{cursor:pointer}
pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0}pre.err{color:var(--bad);background:var(--badbg);padding:8px;border-radius:6px;font-size:12px}pre.cmd,pre.final{background:var(--code);padding:10px 12px;border-radius:8px;font-size:13px}
.bars{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
.bar-row{display:grid;grid-template-columns:minmax(140px,240px) 1fr auto;gap:12px;align-items:center;padding:5px 0}
.bar-track{position:relative;height:12px}.bar{height:12px;background:var(--s1);border-radius:0 4px 4px 0}.bar.over{background:var(--bad)}
.bar-limit{position:absolute;top:-3px;width:2px;height:18px;background:var(--text2)}.bar-value{font-variant-numeric:tabular-nums;font-size:13px;min-width:110px;text-align:right}
.cards{display:grid;gap:14px}.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}
.card header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.card header p{margin:2px 0 0;font-size:13px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}.metrics div{display:flex;flex-direction:column}.metrics .k{font-size:12px;color:var(--text2)}.metrics .v{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.sub-h{font-size:12px;color:var(--text2);margin-top:4px}
.stack{display:flex;gap:2px;height:12px;margin:6px 0}.seg{border-radius:3px;min-width:3px}.s1{background:var(--s1)}.s2{background:var(--s2)}.s3{background:var(--s3)}.s4{background:var(--s4)}
.stack-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;margin-bottom:8px}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}
.sparks{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px}.spark{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px}.spark-label{font-size:13px;color:var(--text2)}.spark-label strong{color:var(--text)}
.spark-line{fill:none;stroke:var(--s1);stroke-width:2}.spark-dot{fill:var(--s1)}.hit{fill:transparent}.hit:hover{fill:var(--s1);fill-opacity:.15}
footer{margin-top:48px;color:var(--muted);font-size:13px}
@media (max-width:640px){.bar-row{grid-template-columns:1fr;gap:4px}.bar-value{text-align:left}.tile-value{font-size:24px}}
</style></head>
<body><main>
<h1>lunar-skills test report</h1>
<div class="env">Run <span class="mono">${esc(r.runId)}</span> · commit <span class="mono">${esc(r.env.commit || 'uncommitted')}</span> · Node ${esc(r.env.node)} · claude ${esc(r.env.claude || 'not installed')} · codex ${esc(r.env.codex || 'not installed')}</div>
<div class="tiles">${tiles}</div>
${liveSection(r)}
${unitSection(u)}
${budgetSection(r.budget)}
${historySection(history)}
<footer>Refine loop: edit a SKILL.md → <span class="mono">npm test</span> → <span class="mono">npm run eval:live -- --case &lt;id&gt; --repeat 3</span> → compare History. Raw results: <span class="mono">reports/results/${esc(r.runId)}.json</span>; transcripts: <span class="mono">reports/transcripts/${esc(r.runId)}/</span>.</footer>
</main></body></html>`;
}
