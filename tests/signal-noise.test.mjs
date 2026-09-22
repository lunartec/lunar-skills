import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as sn from '../skills/productivity/signal-noise/scripts/signal-noise.mjs';
import { ROOT, tempDir } from './helpers.mjs';

const CLI = path.join(ROOT, 'skills/productivity/signal-noise/scripts/signal-noise.mjs');
const item = (text, cls, effort = 2) => ({ text, class: cls, reason: 'because', effort });
const plan = (items, goal = 'Ship passwordless login to staging') => ({ goal, items });

function withItems(input, name = 'auth') {
  const dir = tempDir('lunar-sn-');
  fs.mkdirSync(path.join(dir, '.signal-noise'));
  fs.writeFileSync(path.join(dir, `.signal-noise/${name}.items.json`), JSON.stringify(input));
  return dir;
}

test('rejects more than five signal items', () => {
  const r = sn.validate(plan([1, 2, 3, 4, 5, 6].map((n) => item(`step ${n}`, 'signal')).concat([item('docs', 'noise')])));
  assert.match(r.errors.join(), /6 signal items: max 5/);
});

test('rejects zero signal, missing reasons, bad classes and effort', () => {
  const r = sn.validate(plan([{ text: 'a', class: 'noise' }, { text: 'b', class: 'maybe', reason: 'x' }, { text: 'c', class: 'noise', reason: 'x', effort: 9 }]));
  const e = r.errors.join('\n');
  assert.match(e, /missing "reason"/);
  assert.match(e, /"class" must be/);
  assert.match(e, /"effort" must be/);
  assert.match(e, /no signal items/);
});

test('requires a real goal sentence', () => {
  assert.match(sn.validate({ goal: 'login', items: [item('a', 'signal')] }).errors.join(), /goal/);
});

test('warns when classification is too generous or plan too small', () => {
  const generous = sn.validate(plan([1, 2, 3, 4, 5].map((n) => item(`s${n}`, 'signal')).concat([item('n', 'noise')])));
  assert.match(generous.warnings.join(), /too generously/);
  const tiny = sn.validate(plan([item('a', 'signal'), item('b', 'noise')]));
  assert.match(tiny.warnings.join(), /fewer than 4/);
});

test('ledger assigns ids, computes focus, writes md + handoff', () => {
  const dir = withItems(plan([item('migration', 'signal', 2), item('endpoint', 'signal', 3), item('readme', 'noise', 1), item('plugin system', 'cut', 4)]));
  const r = sn.cmdLedger(dir, '.signal-noise/auth.items.json');
  assert.deepEqual(r.errors, []);
  const l = r.ledger;
  assert.equal(l.slug, 'auth', 'slug follows the items file name');
  assert.deepEqual(l.items.map((i) => i.id), ['S1', 'S2', 'N1', 'C1']);
  assert.equal(l.stats.focus, 0.83);
  for (const f of ['auth.json', 'auth.md', 'auth.handoff.md']) assert.ok(fs.existsSync(path.join(dir, '.signal-noise', f)), f);
  const handoff = fs.readFileSync(path.join(dir, '.signal-noise/auth.handoff.md'), 'utf8');
  assert.match(handoff, /N1: readme/);
  assert.doesNotMatch(handoff, /migration|plugin system/, 'handoff carries only noise');
});

test('lifecycle: done, add, note, status', () => {
  const dir = withItems(plan([item('migration', 'signal'), item('endpoint', 'signal'), item('readme', 'noise'), item('research', 'noise')]));
  sn.cmdLedger(dir, '.signal-noise/auth.items.json');
  sn.cmdDone(dir, 'auth', 'S1');
  sn.cmdAdd(dir, 'auth', 'tidy logger');
  sn.cmdNote(dir, 'auth', 'N1', 'later', 'needs a diagram');
  assert.throws(() => sn.cmdNote(dir, 'auth', 'S2', 'done', 'x'), /not a noise item/);
  assert.throws(() => sn.cmdNote(dir, 'auth', 'N2', 'maybe', 'x'), /verdict/);
  const s = sn.status(sn.load(dir));
  assert.match(s, /\[x\] S1 migration/);
  assert.match(s, /signal done 1\/2 \| noise reviewed 1\/3/);
  assert.match(s, /N1 later: needs a diagram/);
});

test('CLI exits non-zero with actionable errors', () => {
  const dir = withItems(plan([1, 2, 3, 4, 5, 6].map((n) => item(`s${n}`, 'signal'))));
  let out = '';
  try { execFileSync('node', [CLI, 'ledger', '.signal-noise/auth.items.json'], { cwd: dir, encoding: 'utf8' }); } catch (e) { out = e.stdout; }
  assert.match(out, /error: 6 signal items/);
});

test('signal card stays small', () => {
  const dir = withItems(plan([item('a thing', 'signal'), item('b thing', 'signal'), item('c thing', 'signal')].concat(Array.from({ length: 30 }, (_, i) => item(`noise ${i}`, 'noise')))));
  const out = execFileSync('node', [CLI, 'ledger', '.signal-noise/auth.items.json'], { cwd: dir, encoding: 'utf8' });
  assert.ok(out.split('\n').filter(Boolean).length <= 6, 'card lists only signal, not the 30 noise items');
});
