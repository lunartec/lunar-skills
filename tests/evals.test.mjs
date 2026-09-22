import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, tempDir } from './helpers.mjs';
import { check, gradeCase } from '../evals/lib/grade.mjs';
import { parseTranscript, prepareWorkspace } from '../evals/lib/live.mjs';
import { renderHtml, cheapShare } from '../evals/lib/html.mjs';
import { loadCases, summarise } from '../evals/run.mjs';
import { budget } from '../scripts/budget.mjs';

const KNOWN = /^(file|chaos\.(areas|flagged|notFlagged|concern|escalated)|sn\.(ledger|signalCount|signal|notSignal|handoff|quickPass)|da\.(report|verdict|lens)|orchestratorDidNotRead|delegated|skillInvoked|maxCostUSD)$/;
const noTranscript = { raw: '', mainToolCalls: [], hasToolDetail: true, metrics: { byModel: {} } };

test('every live case is well formed and points at real fixtures and skills', () => {
  const cases = loadCases(ROOT);
  assert.ok(cases.length >= 6);
  const ids = new Set();
  for (const c of cases) {
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`); ids.add(c.id);
    assert.ok(fs.existsSync(path.join(ROOT, 'evals/fixtures', c.fixture)), `${c.id}: fixture`);
    assert.ok(fs.existsSync(path.join(ROOT, 'skills')) && ['chaos-storm', 'signal-noise', 'devils-advocate'].includes(c.skill), `${c.id}: skill`);
    assert.ok(c.prompt.claude && c.prompt.codex, `${c.id}: prompt per agent`);
    if (c.branch) assert.ok(fs.existsSync(path.join(ROOT, 'evals/fixtures/overlays', c.branch.overlay)), `${c.id}: overlay`);
    for (const a of c.assert) assert.match(a.type, KNOWN, `${c.id}: unknown assertion ${a.type}`);
  }
});

test('workspace prep installs the skill for each agent, runs setup and builds branches', () => {
  const cases = loadCases(ROOT);
  const chaos = cases.find((c) => c.id === 'chaos-mono-health');
  const ws = prepareWorkspace(ROOT, chaos, 'claude');
  assert.ok(fs.existsSync(path.join(ws, '.claude/skills/chaos-storm/SKILL.md')));
  assert.ok(fs.existsSync(path.join(ws, '.chaos-storm/map.json')), 'setup ran');
  const map = JSON.parse(fs.readFileSync(path.join(ws, '.chaos-storm/map.json'), 'utf8'));
  assert.ok(!map.areas.some((a) => a.path.startsWith('.claude')), 'installed skill is not mapped as product code');
  const da = cases.find((c) => c.id === 'da-branch-overengineered');
  const ws2 = prepareWorkspace(ROOT, da, 'codex');
  assert.ok(fs.existsSync(path.join(ws2, '.agents/skills/devils-advocate/SKILL.md')));
  assert.ok(fs.existsSync(path.join(ws2, 'packages/utils/src/formatting/CurrencyFormatterFactory.ts')), 'branch overlay applied');
});

test('graders: signal-noise ledger assertions', () => {
  const ws = tempDir('lunar-grade-');
  fs.mkdirSync(path.join(ws, '.signal-noise'));
  const ledger = { slug: 'x', stats: { signal: 2, noise: 1, cut: 0 }, items: [
    { id: 'S1', class: 'signal', text: 'Add login_tokens migration', reason: 'core' },
    { id: 'S2', class: 'signal', text: 'Research competitor pages', reason: 'oops' },
    { id: 'N1', class: 'noise', text: 'Update logo', reason: 'polish' },
  ] };
  fs.writeFileSync(path.join(ws, '.signal-noise/x.json'), JSON.stringify(ledger));
  const ctx = { ws, transcript: noTranscript };
  assert.equal(check({ type: 'sn.signal', match: 'migration' }, ctx).pass, true);
  assert.equal(check({ type: 'sn.notSignal', match: 'logo' }, ctx).pass, true);
  assert.equal(check({ type: 'sn.notSignal', match: 'competitor' }, ctx).pass, false);
  assert.equal(check({ type: 'sn.signalCount', min: 3, max: 5 }, ctx).pass, false);
  assert.equal(check({ type: 'sn.handoff' }, ctx).pass, false);
});

test('graders: soft failures warn, hard failures fail, n/a is neutral', () => {
  const ws = tempDir('lunar-grade-');
  const kase = { assert: [{ type: 'file', glob: 'nope/*.json', soft: true }, { type: 'orchestratorDidNotRead', paths: ['a.ts'] }] };
  const soft = gradeCase(kase, { ws, transcript: { ...noTranscript, hasToolDetail: false } });
  assert.equal(soft.status, 'pass');
  assert.equal(soft.assertions[1].pass, null);
  const hard = gradeCase({ assert: [{ type: 'file', glob: 'nope/*.json' }] }, { ws, transcript: noTranscript });
  assert.equal(hard.status, 'fail');
});

test('orchestratorDidNotRead ignores script calls and subagent reads', () => {
  const raw = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node x/chaos-storm.mjs deps src/a.ts' } }] } },
    { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/ws/src/a.ts' } }] } },
    { type: 'result', total_cost_usd: 0.42, duration_ms: 1000, num_turns: 3, modelUsage: { 'claude-haiku-4-5': { inputTokens: 900, outputTokens: 100, costUSD: 0.01 }, 'claude-sonnet-5': { inputTokens: 100, outputTokens: 0, costUSD: 0.41 } } },
  ].map((e) => JSON.stringify(e)).join('\n');
  const t = parseTranscript('claude', raw);
  assert.equal(t.mainToolCalls.length, 1);
  assert.equal(t.subToolCalls, 1);
  assert.equal(t.metrics.costUSD, 0.42);
  assert.equal(t.metrics.delegatedShare, null, 'no per-message usage in this synthetic transcript');
  const withUsage = parseTranscript('claude', [
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 0 }, content: [] } },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 0 }, content: [] } },
    { type: 'assistant', parent_tool_use_id: 't', message: { id: 'm2', usage: { input_tokens: 300, output_tokens: 0 }, content: [] } },
  ].map((e) => JSON.stringify(e)).join('\n'));
  assert.equal(withUsage.metrics.delegatedShare, 0.75, 'dedupes repeated message ids');
  assert.equal(check({ type: 'orchestratorDidNotRead', paths: ['src/a.ts'] }, { ws: '/', transcript: t }).pass, true);
  assert.equal(Math.round(cheapShare(t.metrics.byModel) * 100), 91);
  const bad = parseTranscript('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/ws/src/a.ts' } }] } }));
  assert.equal(check({ type: 'orchestratorDidNotRead', paths: ['src/a.ts'] }, { ws: '/', transcript: bad }).pass, false);
});

test('codex transcripts: usage and commands are parsed', () => {
  const raw = [
    { type: 'item.completed', item: { type: 'command_execution', command: 'node .agents/skills/signal-noise/scripts/signal-noise.mjs ledger x' } },
    { type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 300 } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
  ].map((e) => JSON.stringify(e)).join('\n');
  const t = parseTranscript('codex', raw);
  assert.equal(t.metrics.inputTokens, 1200);
  assert.equal(t.finalText, 'done');
  assert.equal(check({ type: 'skillInvoked', name: 'signal-noise' }, { ws: '/', transcript: t }).pass, false, 'running the script is not reading SKILL.md');
});

test('HTML report renders with and without live results', () => {
  const base = { runId: 'r1', startedAt: new Date().toISOString(), env: { node: 'v22', commit: 'abc' }, unit: { pass: 2, fail: 1, skip: 0, tests: [{ name: 't<1>', file: 'tests/x.test.mjs', status: 'fail', durationMs: 3, error: 'boom <b>' }] }, budget: budget(ROOT), live: [], liveRequested: false, liveSkipped: [] };
  const html = renderHtml(base, [summarise(base)]);
  assert.match(html, /<title>lunar-skills test report<\/title>/);
  assert.match(html, /Live evals/);
  assert.ok(html.includes('t&lt;1&gt;') && !html.includes('t<1>'), 'escapes test names');
  const withLive = { ...base, liveRequested: true, live: [{ case: 'c1', skill: 'signal-noise', agent: 'claude', repeat: 0, status: 'pass', assertions: [{ name: 'a', pass: true, detail: 'd' }], metrics: { costUSD: 0.1, durationMs: 2000, turns: 4, inputTokens: 10, outputTokens: 5, mainToolCalls: 3, byModel: { 'claude-haiku-4-5': { input: 10, output: 5, costUSD: 0.1 } } } }] };
  const h2 = renderHtml(withLive, [summarise(base), summarise(withLive)]);
  assert.match(h2, /Fast-tier share/);
  assert.match(h2, /100%/);
});
