#!/usr/bin/env node
// lunar-skills test harness.
//   node evals/run.mjs                      unit tests + prompt budgets -> reports/test-report.html
//   node evals/run.mjs --live               + live evals on every installed agent CLI (claude, codex)
//   options: --agent claude|codex  --case <substring>  --skill <name>  --repeat N  --jobs N
//            --model <id>  --keep (keep workspaces)  --no-unit  --open
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runUnit } from './lib/unit.mjs';
import { runLiveCase, available, version, AGENTS } from './lib/live.mjs';
import { renderHtml } from './lib/html.mjs';
import { budget } from '../scripts/budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'reports');

function args() {
  const o = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) { o._.push(a[i]); continue; }
    const k = a[i].slice(2);
    if (a[i + 1] && !a[i + 1].startsWith('--')) o[k] = a[++i]; else o[k] = true;
  }
  return o;
}

export function loadCases(root = ROOT) {
  const base = path.join(root, 'evals/cases');
  const out = [];
  for (const skill of fs.readdirSync(base)) {
    for (const f of fs.readdirSync(path.join(base, skill)).filter((x) => x.endsWith('.json'))) {
      out.push(JSON.parse(fs.readFileSync(path.join(base, skill, f), 'utf8')));
    }
  }
  return out;
}

async function pool(tasks, jobs) {
  const results = [];
  let i = 0;
  const worker = async () => { while (i < tasks.length) { const idx = i++; results[idx] = await tasks[idx](); } };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  return results;
}

const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

async function main() {
  const o = args();
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, '-').slice(0, 19);
  const result = {
    runId, startedAt,
    env: { node: process.version, platform: `${process.platform}-${process.arch}`, commit: git('rev-parse', '--short', 'HEAD'), claude: version('claude'), codex: version('codex') },
    unit: null, budget: budget(ROOT), live: [], liveRequested: Boolean(o.live), liveSkipped: [],
  };

  if (!o['no-unit']) {
    process.stdout.write('unit tests... ');
    result.unit = await runUnit(ROOT);
    console.log(`${result.unit.pass} pass, ${result.unit.fail} fail`);
    for (const t of result.unit.tests.filter((x) => x.status === 'fail')) console.log(`  FAIL ${t.file} :: ${t.name}\n    ${String(t.error).split('\n')[0]}`);
  }

  if (o.live) {
    const wanted = o.agent && o.agent !== 'all' ? [o.agent] : Object.keys(AGENTS);
    const agents = wanted.filter((a) => { const ok = available(a); if (!ok) result.liveSkipped.push(`${a}: CLI not found on PATH`); return ok; });
    const cases = loadCases().filter((c) => (!o.case || c.id.includes(o.case)) && (!o.skill || c.skill === o.skill));
    const repeat = Number(o.repeat || 1);
    const tasks = [];
    for (const c of cases) for (const a of agents) for (let r = 0; r < repeat; r++) {
      tasks.push(async () => {
        const res = await runLiveCase(ROOT, c, a, { model: o.model, keep: Boolean(o.keep), repeatIndex: r, transcriptDir: path.join(REPORTS, 'transcripts', runId) });
        const m = res.metrics;
        console.log(`live ${res.status.toUpperCase().padEnd(5)} ${c.id} [${a}#${r}] ${m.costUSD != null ? `$${m.costUSD.toFixed(3)} ` : ''}${Math.round((m.durationMs || 0) / 1000)}s${res.error ? ` ${res.error}` : ''}`);
        for (const x of res.assertions.filter((y) => y.pass === false)) console.log(`   ${x.soft ? 'warn' : 'fail'}: ${x.name} (${x.detail})`);
        return res;
      });
    }
    if (!tasks.length) console.log('live: nothing to run', result.liveSkipped.join('; '));
    result.live = await pool(tasks, Number(o.jobs || 2));
  }

  result.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.join(REPORTS, 'results'), { recursive: true });
  fs.writeFileSync(path.join(REPORTS, 'results', `${runId}.json`), JSON.stringify(result, null, 2));
  const histFile = path.join(REPORTS, 'history.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch { /* first run */ }
  history.push(summarise(result));
  history = history.slice(-50);
  fs.writeFileSync(histFile, JSON.stringify(history, null, 2));
  const html = path.join(REPORTS, 'test-report.html');
  fs.writeFileSync(html, renderHtml(result, history));
  console.log(`report: ${path.relative(process.cwd(), html)}`);
  const failed = (result.unit?.fail || 0) + result.live.filter((l) => l.status !== 'pass').length + result.budget.filter((b) => !b.ok).length;
  if (failed) process.exitCode = 1;
}

export function summarise(r) {
  const live = r.live || [];
  const bySkill = {};
  for (const l of live) {
    const s = (bySkill[l.skill] ||= { runs: 0, pass: 0, cost: 0, tokens: 0 });
    s.runs++; if (l.status === 'pass') s.pass++;
    s.cost += l.metrics.costUSD || 0;
    s.tokens += (l.metrics.inputTokens || 0) + (l.metrics.outputTokens || 0);
  }
  return {
    runId: r.runId, at: r.startedAt, commit: r.env.commit,
    unitPass: r.unit?.pass ?? null, unitFail: r.unit?.fail ?? null,
    livePass: live.filter((l) => l.status === 'pass').length, liveTotal: live.length,
    liveCost: Math.round(live.reduce((a, l) => a + (l.metrics.costUSD || 0), 0) * 1000) / 1000,
    skillTokens: Object.fromEntries(r.budget.map((b) => [b.skill, b.parts.find((p) => p.kind === 'skill')?.tokens])),
    bySkill,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
