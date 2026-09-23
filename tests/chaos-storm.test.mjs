import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as cs from '../skills/engineering/chaos-storm/scripts/chaos-storm.mjs';
import { fixtureRepo, ROOT } from './helpers.mjs';

const CLI = path.join(ROOT, 'skills/engineering/chaos-storm/scripts/chaos-storm.mjs');
const run = (cwd, ...args) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });

function configured() {
  const dir = fixtureRepo('mono');
  cs.cmdMap(dir);
  cs.cmdConfigure(dir, { include: 'apps/*,packages/*,tools', ext: '.ts,.tsx,.py,.sh', sample: '5' });
  return dir;
}

test('glob matching handles ** and basename patterns', () => {
  assert.ok(cs.matchAny('a/b/c.test.ts', ['**/*.test.*']));
  assert.ok(cs.matchAny('c.test.ts', ['**/*.test.*']));
  assert.ok(cs.matchAny('pkg/tests/x.ts', ['**/tests/**']));
  assert.ok(!cs.matchAny('pkg/src/x.ts', ['**/tests/**']));
  assert.ok(cs.matchAny('apps/web', ['apps/*']));
  assert.ok(!cs.matchAny('apps/web/src', ['apps/*']));
});

test('map detects workspace apps, packages and loose tool dirs', () => {
  const dir = fixtureRepo('mono');
  const r = cs.cmdMap(dir);
  assert.equal(r.status, 'draft');
  const byName = Object.fromEntries(r.map.areas.map((a) => [a.name, a]));
  assert.equal(byName['apps/web'].kind, 'app');
  assert.equal(byName['apps/api'].kind, 'app');
  assert.equal(byName['packages/utils'].kind, 'package');
  assert.equal(byName['tools'].kind, 'tool');
  assert.ok(!byName['infra'], 'non-code dirs are not areas');
  assert.deepEqual(r.map.unclassified, []);
  assert.ok(r.map.extensions['.ts'] > 0);
});

test('unknown top-level code dirs in a monorepo are flagged for the mapper subagent', () => {
  const dir = fixtureRepo('mono');
  fs.mkdirSync(path.join(dir, 'edge'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'edge/worker.ts'), 'export default {}\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const r = cs.cmdMap(dir);
  assert.deepEqual(r.map.unclassified, ['edge']);
});

test('map is a no-op once map.json exists', () => {
  const dir = configured();
  assert.equal(cs.cmdMap(dir).status, 'exists');
  assert.ok(!fs.existsSync(path.join(dir, '.chaos-storm/map.draft.json')), 'draft removed after configure');
});

test('configure applies include globs, extensions and sample size', () => {
  const dir = fixtureRepo('mono');
  cs.cmdMap(dir);
  const m = cs.cmdConfigure(dir, { include: 'packages/*', ext: 'ts,tsx', sample: '2' });
  assert.deepEqual(m.areas.filter((a) => a.include).map((a) => a.name).sort(), ['packages/ui', 'packages/utils']);
  assert.deepEqual(m.extensions, ['.ts', '.tsx']);
  assert.equal(m.sample, 2);
});

test('select is deterministic for a seed and respects excludes, extensions and minLines', () => {
  const a = configured();
  const b = configured();
  const sa = cs.cmdSelect(a, { seed: 's1', run: 'r1' });
  const sb = cs.cmdSelect(b, { seed: 's1', run: 'r1' });
  assert.deepEqual(sa.areas.map((x) => x.files), sb.areas.map((x) => x.files));
  const all = sa.areas.flatMap((x) => x.files.map((f) => f.path));
  assert.ok(!all.some((f) => f.includes('.test.')), 'tests excluded');
  assert.ok(!all.includes('apps/api/src/__init__.py'), 'trivial files skipped');
  assert.ok(all.every((f) => /\.(ts|tsx|py|sh)$/.test(f)));
});

test('select caps at sample size and prefers unseen files on the next run', () => {
  const dir = configured();
  const first = cs.cmdSelect(dir, { seed: 'x', run: 'r1', sample: '1' });
  const second = cs.cmdSelect(dir, { seed: 'x', run: 'r2', sample: '1' });
  const utils = (s) => s.areas.find((a) => a.area === 'packages/utils').files;
  assert.equal(utils(first).length, 1);
  assert.notEqual(utils(first)[0].path, utils(second)[0].path);
});

test('deps resolves relative, tsconfig paths, workspace packages and python imports', () => {
  const dir = fixtureRepo('mono');
  assert.deepEqual(cs.resolveDeps(dir, 'apps/web/src/checkout.ts'), ['apps/web/src/summary.ts', 'packages/utils/src/index.ts', 'packages/utils/src/slugify.ts']);
  assert.deepEqual(cs.resolveDeps(dir, 'apps/web/src/router.ts'), ['apps/web/src/checkout.ts', 'packages/utils/src/mega.ts']);
  assert.deepEqual(cs.resolveDeps(dir, 'apps/api/src/server.py'), ['apps/api/src/handlers.py']);
  assert.deepEqual(cs.resolveDeps(dir, 'packages/ui/src/Button.tsx'), []);
});

test('scoring: flag rules and grades', () => {
  const ok = { scores: { purpose: 4, approach: 4, focus: 4, reasoning: 3 } };
  const lowMean = { scores: { purpose: 3, approach: 3, focus: 3, reasoning: 2 } };
  const floor = { scores: { purpose: 5, approach: 5, focus: 5, reasoning: 2 } };
  assert.equal(cs.isFlagged(ok), false);
  assert.equal(cs.isFlagged(lowMean), true);
  assert.equal(cs.isFlagged(floor), true, 'any dimension at the floor flags');
  assert.equal(cs.grade(4.6), 'A');
  assert.equal(cs.grade(3.1), 'C');
  assert.equal(cs.grade(1.5), 'E');
});

const A = (p, a, f, r) => ({ purpose: p, approach: a, focus: f, reasoning: r });
const goodFile = (p) => ({ path: p, scores: { purpose: 5, approach: 4, focus: 5, reasoning: 4 }, assessment: A('Does one thing.', 'Simply.', 'Nothing extra.', 'Self-contained.') });

test('validateReview enforces the four-question contract', () => {
  assert.deepEqual(cs.validateReview({ area: 'x', files: [goodFile('a.ts')] }), []);
  const bad = { area: 'x', files: [{ path: 'a.ts', scores: { purpose: 6, approach: 4, focus: 5 }, assessment: { purpose: 'p', approach: 'word '.repeat(30) } }] };
  const errs = cs.validateReview(bad).join('\n');
  assert.match(errs, /scores.purpose/);
  assert.match(errs, /scores.reasoning/);
  assert.match(errs, /assessment.focus must answer "What is it doing outside its purpose\?"/);
  assert.match(errs, /assessment.approach is 30 words/);
  const flaggedNoAction = { area: 'x', files: [{ ...goodFile('a.ts'), scores: { purpose: 4, approach: 2, focus: 4, reasoning: 4 } }] };
  assert.match(cs.validateReview(flaggedNoAction).join(), /needs an "action"/);
  const esc = { area: 'x', files: [{ ...goodFile('a.ts'), verdict: 'concern' }] };
  const e = cs.validateReview(esc, { escalated: true }).join();
  assert.match(e, /action/);
  assert.match(e, /deps/);
});

test('full pipeline with golden reviews: escalate, clear, concern, lean report', () => {
  const dir = configured();
  const sel = cs.cmdSelect(dir, { seed: 'golden', run: 'g1', sample: '5' });
  const rdir = path.join(dir, '.chaos-storm/runs/g1/reviews');
  fs.mkdirSync(rdir, { recursive: true });
  for (const a of sel.areas) {
    const files = a.files.map((f) => {
      if (f.path.endsWith('mega.ts')) return { path: f.path, scores: { purpose: 1, approach: 2, focus: 1, reasoning: 1 }, assessment: A('Unclear grab bag keyed on a mode string.', 'One function branching on mode.', 'Caching, file IO, tax, email checks.', 'Module-level mutable cache and counter.'), action: 'Split doStuff into one function per mode; delete the global cache.' };
      if (f.path.endsWith('router.ts')) return { path: f.path, scores: { purpose: 3, approach: 2, focus: 2, reasoning: 2 }, assessment: A('Routes requests.', 'If-chain over paths.', 'Analytics, random feature flags.', 'Randomness and globals.'), action: 'Move analytics and flags out of the router.' };
      if (f.path.endsWith('checkout.ts')) return { path: f.path, scores: { purpose: 4, approach: 3, focus: 3, reasoning: 2 }, assessment: A('Builds checkout view.', 'Reduce plus helpers.', 'Nothing extra.', 'Depends on imported helpers.'), action: 'Inline the summary helper.' };
      return goodFile(f.path);
    });
    fs.writeFileSync(path.join(rdir, `${a.slug}.json`), JSON.stringify({ area: a.slug, files }));
  }
  assert.deepEqual(cs.cmdValidate(dir, 'g1'), {});
  const esc = cs.cmdEscalate(dir, 'g1');
  assert.deepEqual(esc.items.map((i) => i.path).sort(), ['apps/web/src/checkout.ts', 'apps/web/src/router.ts', 'packages/utils/src/mega.ts']);
  assert.ok(esc.items.find((i) => i.path.endsWith('checkout.ts')).deps.includes('apps/web/src/summary.ts'));
  // checkout clears with context; router stays a concern; mega is left unescalated on purpose.
  fs.writeFileSync(path.join(rdir, 'apps-web.escalated.json'), JSON.stringify({ area: 'apps-web', files: [
    { ...goodFile('apps/web/src/checkout.ts'), deps: ['apps/web/src/summary.ts'], verdict: 'cleared' },
    { path: 'apps/web/src/router.ts', scores: { purpose: 2, approach: 2, focus: 1, reasoning: 2 }, assessment: A('Routes, tracks and flags.', 'If-chain.', 'Analytics, flags, logging.', 'Random flags make it unpredictable.'), deps: ['apps/web/src/checkout.ts'], verdict: 'concern', action: 'Move analytics and flags out of the router.' },
  ] }));
  assert.deepEqual(cs.cmdValidate(dir, 'g1'), {});
  const r = cs.cmdReport(dir, 'g1');
  const web = r.areas.find((a) => a.area === 'apps/web');
  const byPath = Object.fromEntries(web.files.map((f) => [f.path, f]));
  assert.equal(byPath['apps/web/src/checkout.ts'].status, 'cleared');
  assert.equal(byPath['apps/web/src/checkout.ts'].action, null, 'cleared files carry no action');
  assert.equal(byPath['apps/web/src/router.ts'].status, 'concern');
  assert.equal(byPath['apps/web/src/router.ts'].assessment.focus, 'Analytics, flags, logging.', 'report shows the post-escalation assessment');
  assert.equal(r.concerns.length, 2);
  assert.deepEqual(r.actions.map((x) => x.path), ['packages/utils/src/mega.ts', 'apps/web/src/router.ts'], 'worst first');
  const md = fs.readFileSync(path.join(dir, '.chaos-storm/runs/g1/report.md'), 'utf8');
  assert.match(md, /\| Question \| Score \| Assessment \|/);
  assert.match(md, /\| What is it doing outside its purpose\? \| 1 \| Analytics, flags, logging. \|/);
  assert.match(md, /Drilled into imports: `apps\/web\/src\/checkout.ts` → still a concern \(2.25 → 1.75\)/);
  assert.match(md, /Drilled into imports: `apps\/web\/src\/summary.ts` → cleared \(3 → 4.5\)/);
  assert.match(md, /mega.ts` · 1.25 · flagged[\s\S]*Flagged, not yet drilled into imports/);
  assert.match(md, /## Remedial actions/);
  assert.match(md, /\| 1 \| `packages\/utils\/src\/mega.ts` \| 1.25 \| flagged \| Split doStuff/);
  assert.doesNotMatch(md, /\*\*Action:\*\* Inline the summary helper/, 'no action for cleared files');
});

test('CLI prints compact output (orchestrator context stays small)', () => {
  const dir = fixtureRepo('mono');
  const mapOut = run(dir, 'map');
  assert.ok(mapOut.length < 1200, `map output ${mapOut.length} chars`);
  run(dir, 'configure', '--include', 'apps/*,packages/*', '--ext', '.ts,.py');
  const sel = run(dir, 'select', '--seed', 'z');
  assert.ok(sel.split('\n').length < 12);
  assert.match(run(dir, 'map'), /^map exists/);
});
