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

test('validateReview enforces the four-question contract', () => {
  const good = { area: 'x', files: [{ path: 'a.ts', purpose: 'p', how: 'h', outside: [], scores: { purpose: 5, approach: 4, focus: 5, reasoning: 4 } }] };
  assert.deepEqual(cs.validateReview(good), []);
  const bad = { area: 'x', files: [{ path: 'a.ts', purpose: 'p', scores: { purpose: 6, approach: 4, focus: 5 } }] };
  const errs = cs.validateReview(bad).join('\n');
  assert.match(errs, /"how"/);
  assert.match(errs, /outside/);
  assert.match(errs, /scores.purpose/);
  assert.match(errs, /scores.reasoning/);
  const esc = { ...good, files: [{ ...good.files[0], verdict: 'concern' }] };
  assert.match(cs.validateReview(esc, { escalated: true }).join(), /action/);
});

test('full pipeline with golden reviews: escalate, clear, concern, report', () => {
  const dir = configured();
  const sel = cs.cmdSelect(dir, { seed: 'golden', run: 'g1', sample: '5' });
  const rdir = path.join(dir, '.chaos-storm/runs/g1/reviews');
  fs.mkdirSync(rdir, { recursive: true });
  const good = (p) => ({ path: p, purpose: 'Does one thing.', how: 'Simply.', outside: [], scores: { purpose: 5, approach: 4, focus: 5, reasoning: 4 } });
  for (const a of sel.areas) {
    const files = a.files.map((f) => {
      if (f.path.endsWith('mega.ts')) return { ...good(f.path), purpose: 'Unclear grab bag.', outside: ['caching', 'file IO', 'tax'], scores: { purpose: 1, approach: 2, focus: 1, reasoning: 1 } };
      if (f.path.endsWith('router.ts')) return { ...good(f.path), outside: ['analytics', 'flags'], scores: { purpose: 3, approach: 2, focus: 2, reasoning: 2 } };
      if (f.path.endsWith('checkout.ts')) return { ...good(f.path), scores: { purpose: 4, approach: 3, focus: 3, reasoning: 2 } };
      return good(f.path);
    });
    fs.writeFileSync(path.join(rdir, `${a.slug}.json`), JSON.stringify({ area: a.slug, files }));
  }
  assert.deepEqual(cs.cmdValidate(dir, 'g1'), {});
  const esc = cs.cmdEscalate(dir, 'g1');
  const flagged = esc.items.map((i) => i.path).sort();
  assert.deepEqual(flagged, ['apps/web/src/checkout.ts', 'apps/web/src/router.ts', 'packages/utils/src/mega.ts']);
  assert.ok(esc.items.find((i) => i.path.endsWith('checkout.ts')).deps.includes('apps/web/src/summary.ts'));
  // checkout clears with context; router stays a concern; mega is left unescalated on purpose.
  fs.writeFileSync(path.join(rdir, 'apps-web.escalated.json'), JSON.stringify({ area: 'apps-web', files: [
    { ...good('apps/web/src/checkout.ts'), deps: ['apps/web/src/summary.ts'], verdict: 'cleared' },
    { ...good('apps/web/src/router.ts'), outside: ['analytics'], scores: { purpose: 2, approach: 2, focus: 1, reasoning: 2 }, deps: [], verdict: 'concern', action: 'Move analytics and flags out of the router.' },
  ] }));
  assert.deepEqual(cs.cmdValidate(dir, 'g1'), {});
  const r = cs.cmdReport(dir, 'g1');
  const web = r.areas.find((a) => a.area === 'apps/web');
  const st = Object.fromEntries(web.files.map((f) => [f.path, f.status]));
  assert.equal(st['apps/web/src/checkout.ts'], 'cleared');
  assert.equal(st['apps/web/src/router.ts'], 'concern');
  assert.equal(r.concerns.length, 2);
  assert.ok(r.concerns.some((c) => c.status === 'flagged-unescalated' && c.path.endsWith('mega.ts')));
  const md = fs.readFileSync(path.join(dir, '.chaos-storm/runs/g1/report.md'), 'utf8');
  assert.match(md, /Concerns to action/);
  assert.match(md, /Move analytics and flags out of the router/);
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
