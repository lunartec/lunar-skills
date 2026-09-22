#!/usr/bin/env node
// Re-render the HTML report from saved results without re-running anything (free).
// Metrics are refreshed from saved transcripts, so report changes apply to past runs too.
//   node evals/report.mjs [reports/results/<run>.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from './lib/html.mjs';
import { parseTranscript } from './lib/live.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'reports');
const resultsDir = path.join(REPORTS, 'results');
const file = process.argv[2] || path.join(resultsDir, fs.readdirSync(resultsDir).filter((f) => f.endsWith('.json')).sort().pop());
const r = JSON.parse(fs.readFileSync(file, 'utf8'));

for (const l of r.live || []) {
  const t = path.join(REPORTS, 'transcripts', r.runId, `${l.case}.${l.agent}.${l.repeat || 0}.jsonl`);
  if (!fs.existsSync(t)) continue;
  const m = parseTranscript(l.agent, fs.readFileSync(t, 'utf8')).metrics;
  l.metrics = { ...l.metrics, ...m, mainToolCalls: l.metrics.mainToolCalls, subToolCalls: l.metrics.subToolCalls };
}

let history = [];
try { history = JSON.parse(fs.readFileSync(path.join(REPORTS, 'history.json'), 'utf8')); } catch { /* none */ }
const out = path.join(REPORTS, 'test-report.html');
fs.writeFileSync(out, renderHtml(r, history));
console.log(`report: ${path.relative(process.cwd(), out)} (from ${path.relative(process.cwd(), file)})`);
