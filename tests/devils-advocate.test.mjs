import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as da from '../skills/engineering/devils-advocate/scripts/devils-advocate.mjs';
import { fixtureRepo, FIXTURES, ROOT } from './helpers.mjs';

const CLI = path.join(ROOT, 'skills/engineering/devils-advocate/scripts/devils-advocate.mjs');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, stdio: 'pipe' });

function branchRepo() {
  const dir = fixtureRepo('mono');
  git(dir, 'checkout', '-qb', 'main');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'feature/currency-formatter');
  fs.cpSync(path.join(FIXTURES, 'overlays/currency-formatter'), dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Add extensible currency formatter factory');
  return dir;
}

const goodChallenge = () => ({
  understanding: 'The branch adds an extensible currency formatter so future currencies can be plugged in without touching checkout.',
  verdict: 'adjust',
  challenges: [{
    lens: 'duplication', claim: 'formatGBP already does this.', evidence: ['packages/utils/src/money.ts:2'],
    steelman: 'Multi-currency may be on the roadmap.', question: 'Is a second currency planned this quarter?',
    alternative: 'Keep formatGBP; add a currency parameter when a second currency is real.', confidence: 'high', consequence: 'med',
  }],
  wouldChangeMind: ['A committed roadmap item for multi-currency checkout.'],
});

test('resolves paths, PR numbers, ranges and branches', () => {
  const dir = branchRepo();
  assert.equal(da.resolveTarget(dir, 'packages/utils').kind, 'dir');
  assert.equal(da.resolveTarget(dir, 'packages/utils/src/money.ts').kind, 'file');
  assert.equal(da.resolveTarget(dir, '#42').kind, 'pr');
  assert.deepEqual(da.resolveTarget(dir, 'main..feature/currency-formatter').base, 'main');
  const b = da.resolveTarget(dir, 'feature/currency-formatter');
  assert.equal(b.kind, 'branch');
  assert.equal(b.base, 'main');
  assert.throws(() => da.resolveTarget(dir, 'no-such-thing'), /cannot resolve/);
});

test('parseDiff tracks new files, added line numbers and removals', () => {
  const diff = ['diff --git a/x.ts b/x.ts', 'new file mode 100644', '--- /dev/null', '+++ b/x.ts', '@@ -0,0 +1,2 @@', '+export const a = 1;', '+export class B {}',
    'diff --git a/y.ts b/y.ts', '--- a/y.ts', '+++ b/y.ts', '@@ -3 +3 @@', '-old', '+new'].join('\n');
  const f = da.parseDiff(diff);
  assert.equal(f[0].status, 'added');
  assert.deepEqual(f[0].added.map((l) => l.n), [1, 2]);
  assert.equal(f[1].removed, 1);
  assert.equal(f[1].added[0].n, 3);
});

test('branch brief surfaces duplication, abstraction density and new dirs', () => {
  const dir = branchRepo();
  const b = da.cmdTarget(dir, 'feature/currency-formatter');
  assert.equal(b.totals.newFiles, 3);
  assert.ok(b.signals.abstractionPer100Loc > 5, `density ${b.signals.abstractionPer100Loc}`);
  assert.deepEqual(b.signals.newDirs, ['packages/utils/src/formatting']);
  assert.ok(b.dupHints.some((h) => h.similar.includes('packages/utils/src/money.ts')), JSON.stringify(b.dupHints));
  assert.ok(b.exports.some((e) => e.name === 'CurrencyFormatterFactory'));
  assert.deepEqual(b.target.log, ['Add extensible currency formatter factory']);
  assert.ok(fs.existsSync(path.join(dir, '.devils-advocate/feature-currency-formatter/brief.json')));
});

test('brief text stays compact', () => {
  const dir = branchRepo();
  const out = execFileSync('node', [CLI, 'target', 'feature/currency-formatter'], { cwd: dir, encoding: 'utf8' });
  assert.ok(out.split('\n').length <= 14 && out.length < 1500, out);
});

test('validateChallenge enforces evidence, steelman and honest verdicts', () => {
  assert.deepEqual(da.validateChallenge(goodChallenge()), []);
  const c = goodChallenge();
  delete c.challenges[0].steelman;
  c.challenges[0].evidence = [];
  c.challenges[0].lens = 'vibes';
  const e = da.validateChallenge(c).join('\n');
  assert.match(e, /steelman/);
  assert.match(e, /evidence/);
  assert.match(e, /lens/);
  const contradict = goodChallenge();
  contradict.verdict = 'proceed';
  contradict.challenges[0].consequence = 'high';
  assert.match(da.validateChallenge(contradict).join(), /contradicts/);
  const many = goodChallenge();
  many.challenges = Array(6).fill(goodChallenge().challenges[0]);
  assert.match(da.validateChallenge(many).join(), /strongest 5/);
});

test('render writes a ranked report with the steelman and the question', () => {
  const dir = branchRepo();
  da.cmdTarget(dir, 'feature/currency-formatter');
  const c = goodChallenge();
  c.challenges.unshift({ ...c.challenges[0], lens: 'premise', claim: 'Low-stakes nit.', confidence: 'low', consequence: 'low' });
  fs.writeFileSync(path.join(dir, '.devils-advocate/feature-currency-formatter/challenge.json'), JSON.stringify(c));
  const r = da.cmdRender(dir, 'feature-currency-formatter');
  assert.deepEqual(r.errors, []);
  const md = fs.readFileSync(path.join(dir, r.file), 'utf8');
  assert.ok(md.indexOf('formatGBP already does this') < md.indexOf('Low-stakes nit'), 'ranked by confidence x consequence');
  assert.match(md, /Strongest case for the current approach/);
  assert.match(md, /Question for you/);
  assert.match(md, /Verdict: ADJUST/);
});
