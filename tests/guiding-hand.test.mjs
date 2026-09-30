import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as gh from '../skills/engineering/guiding-hand/scripts/guiding-hand.mjs';
import { fixtureRepo, ROOT } from './helpers.mjs';

const CLI = path.join(ROOT, 'skills/engineering/guiding-hand/scripts/guiding-hand.mjs');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, stdio: 'pipe' });
const EUR_TASK = 'Show checkout totals in EUR as well as GBP; add currency support to the checkout view';

function repo() {
  const dir = fixtureRepo('mono');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

const goodGuide = () => ({
  task: 'Show checkout totals in EUR as well as GBP',
  kind: 'feature',
  goal: { current: ['checkoutView always formats totals as GBP'], proposed: ['Basket currency decides how the total is formatted'], outOfScope: ['Exchange rates'] },
  decisions: [{ q: 'Currency per basket or per user?', a: 'basket', by: 'user' }],
  files: [
    { path: 'packages/utils/src/money.ts', role: 'modify', symbols: ['formatGBP'], why: 'Only currency formatter', change: 'Add formatMoney(pence, currency); keep formatGBP as a wrapper' },
    { path: 'packages/utils/src/index.ts', role: 'modify', why: 'Public API of @mono/utils', change: 'Re-export formatMoney' },
    { path: 'apps/web/src/checkout.ts', role: 'modify', symbols: ['checkoutView'], why: 'Formats the total', change: 'Take a currency argument and call formatMoney' },
    { path: 'packages/utils/src/money.test.ts', role: 'test', new: true, why: 'No money tests today', change: 'GBP and EUR cases; mirror slugify.test.ts' },
    { path: 'packages/utils/src/slugify.test.ts', role: 'reference', why: 'Test style to copy' },
  ],
  steps: ['Write the failing EUR test', 'Add formatMoney to money.ts', 'Re-export it from index.ts', 'Pass the basket currency through checkoutView'],
  guidance: ['Keep money in minor units; format only in checkout.ts'],
  watch: [{ risk: 'Renaming formatGBP breaks @mono/utils consumers', where: 'packages/utils/src/index.ts', level: 'high' }],
  verify: ['npm test', 'checkoutView with an EUR basket shows €12.34'],
  open: [{ q: 'en-IE or de-DE formatting for EUR?', recommend: 'en-IE' }],
});

test('extractTerms keeps identifiers and acronyms, drops filler', () => {
  const t = gh.extractTerms('Please fix `formatGBP` so the checkout shows EUR as well, see apps/web/src/checkout.ts', ['basket']);
  assert.ok(t.includes('formatGBP'));
  assert.ok(t.includes('EUR'));
  assert.ok(t.includes('checkout'));
  assert.ok(t.includes('apps/web/src/checkout.ts'));
  assert.ok(t.includes('basket'));
  for (const w of ['please', 'fix', 'the', 'well', 'see', 'shows']) assert.ok(!t.includes(w), `drops ${w}`);
});

test('countTerm matches short terms as words or camelCase parts only', () => {
  assert.equal(gh.countTerm('Europe neural', 'eur'), 0);
  assert.equal(gh.countTerm('formatGBP(gbp)', 'GBP'), 2);
  assert.equal(gh.countTerm('checkoutView view', 'view'), 2);
  assert.equal(gh.countTerm('currency Currency', 'currency'), 2);
});

test('import graph sees through barrels and tsconfig paths', () => {
  const dir = repo();
  const { fwd, rev } = gh.importGraph(dir, gh.listFiles(dir));
  assert.ok(fwd['apps/web/src/checkout.ts'].includes('packages/utils/src/money.ts'), 'via @mono/utils -> index.ts');
  assert.ok(fwd['apps/web/src/checkout.ts'].includes('packages/utils/src/slugify.ts'), 'via @utils/* path');
  assert.ok(rev['apps/web/src/checkout.ts'].includes('apps/web/src/router.ts'));
  assert.ok(fwd['apps/api/src/server.py'].includes('apps/api/src/handlers.py'));
});

test('scan finds the formatter, its caller and the callers of the caller', () => {
  const dir = repo();
  const b = gh.scan(dir, EUR_TASK);
  const byPath = Object.fromEntries(b.candidates.map((c) => [c.path, c]));
  assert.equal(byPath['apps/web/src/checkout.ts']?.rel, 'seed');
  assert.ok(byPath['packages/utils/src/money.ts'], 'money.ts found');
  assert.ok(byPath['apps/web/src/router.ts'], 'router.ts (imports checkout) found');
  assert.ok(!byPath['infra/main.tf'], 'no noise from infra');
  assert.ok(b.head, 'records HEAD for check');
  assert.ok(fs.existsSync(path.join(dir, gh.DIR, b.slug, 'scan.json')));
  const text = gh.renderScanText(b);
  assert.match(text, /^scan \.guiding-hand\/.+ \| terms: /);
  assert.ok(text.split('\n').length <= 42, 'compact');
});

test('validateGuide accepts a good guide and catches the classic failures', () => {
  const dir = repo();
  assert.deepEqual(gh.validateGuide(dir, goodGuide()), []);
  const bad = goodGuide();
  bad.kind = 'epic';
  bad.files[0].symbols = ['formatEUR'];
  bad.files.push({ path: 'apps/web/src/chekout.ts', role: 'modify', why: 'typo', change: 'x' });
  bad.files.push({ path: 'apps/web/src/summary.ts', role: 'create', why: 'exists', change: 'x' });
  bad.files.push({ path: 'apps/web/src/nope.test.ts', role: 'test', why: 'missing', change: 'x' });
  bad.guidance.push('Handle edge cases');
  bad.steps.push(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n'));
  bad.open.push({ q: 'Anything else?' });
  const e = gh.validateGuide(dir, bad).join('\n');
  assert.match(e, /"kind" must be/);
  assert.match(e, /symbol "formatEUR" not found/);
  assert.match(e, /chekout\.ts: not found/);
  assert.match(e, /summary\.ts: already exists/);
  assert.match(e, /nope\.test\.ts: test file not found/);
  assert.match(e, /placeholder "Handle edge cases"/);
  assert.match(e, /9 lines; guide, do not implement/);
  assert.match(e, /open\[1\]: needs "q" and "recommend"/);
  const bug = { ...goodGuide(), kind: 'bug', goal: { current: [], proposed: ['x'], outOfScope: [] } };
  assert.match(gh.validateGuide(dir, bug).join('\n'), /goal\.current/);
  const noChange = { ...goodGuide(), files: [{ path: 'apps/web/src/router.ts', role: 'check', why: 'caller' }] };
  assert.match(gh.validateGuide(dir, noChange).join('\n'), /at least one "modify" or "create"/);
});

test('render writes guide.md and notes importers missing from the map', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, gh.DIR, 'eur'), { recursive: true });
  fs.writeFileSync(path.join(dir, gh.DIR, 'eur/guide.json'), JSON.stringify(goodGuide()));
  const out = execFileSync('node', [CLI, 'render', 'eur'], { cwd: dir, encoding: 'utf8' });
  assert.match(out, /^\.guiding-hand\/eur\/guide\.md \| feature \| 5 files: 3 modify, 1 test, 1 reference \| 1 watch \| 1 open/);
  assert.match(out, /note: apps\/web\/src\/router\.ts imports apps\/web\/src\/checkout\.ts/);
  const md = fs.readFileSync(path.join(dir, gh.DIR, 'eur/guide.md'), 'utf8');
  for (const h of ['## Goal', '## Decisions', '## File map', '## Approach', '## Coding guidance', '## Watch out for', '## Verify', '## Open questions']) assert.ok(md.includes(h), h);
  assert.match(md, /\| 1 \| `packages\/utils\/src\/money\.ts`<br>`formatGBP` \| modify \|/);
  assert.match(md, /Also imports a file you will modify/);
  fs.writeFileSync(path.join(dir, gh.DIR, 'eur/guide.json'), JSON.stringify({ ...goodGuide(), verify: [] }));
  let failed = null;
  try { execFileSync('node', [CLI, 'render', 'eur'], { cwd: dir, encoding: 'utf8' }); } catch (err) { failed = err.stdout; }
  assert.match(failed, /^error: "verify"/m);
});

test('check compares the engineer\'s changes with the map', () => {
  const dir = repo();
  const b = gh.scan(dir, EUR_TASK, { slug: 'eur' });
  fs.writeFileSync(path.join(dir, gh.DIR, 'eur/guide.json'), JSON.stringify(goodGuide()));
  fs.appendFileSync(path.join(dir, 'packages/utils/src/money.ts'), '\nexport const formatMoney = () => "";\n');
  fs.writeFileSync(path.join(dir, 'packages/utils/src/money.test.ts'), 'test("eur", () => {});\n');
  fs.appendFileSync(path.join(dir, 'infra/main.tf'), '\n# drive-by\n');
  const r = gh.cmdCheck(dir, 'eur');
  assert.equal(r.ref, b.head);
  assert.equal(r.planned, 4);
  assert.equal(r.done, 2);
  assert.deepEqual(r.untouched.map((f) => f.path).sort(), ['apps/web/src/checkout.ts', 'packages/utils/src/index.ts']);
  assert.deepEqual(r.unplanned, ['infra/main.tf']);
});
