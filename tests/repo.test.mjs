import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { listSkills, budget } from '../scripts/budget.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const skills = listSkills(ROOT);

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'SKILL.md needs YAML frontmatter');
  return Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

test('every skill has valid frontmatter matching its folder', () => {
  assert.ok(skills.length >= 3);
  for (const s of skills) {
    const fm = frontmatter(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'));
    assert.equal(fm.name, s.name, `${s.name}: frontmatter name`);
    assert.ok(fm.description && fm.description.length <= 1024, `${s.name}: description 1-1024 chars`);
    assert.doesNotMatch(fm.description, /[<>]/, `${s.name}: no angle brackets in description`);
  }
});

test('invocation mode is consistent between Claude Code and Codex metadata', () => {
  for (const s of skills) {
    const fm = frontmatter(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'));
    const yamlPath = path.join(s.dir, 'agents/openai.yaml');
    assert.ok(fs.existsSync(yamlPath), `${s.name}: agents/openai.yaml`);
    const yaml = fs.readFileSync(yamlPath, 'utf8');
    assert.match(yaml, /display_name:/);
    assert.match(yaml, /short_description:/);
    const userOnly = fm['disable-model-invocation'] === 'true';
    assert.equal(/allow_implicit_invocation:\s*false/.test(yaml), userOnly, `${s.name}: invocation flags out of sync`);
    if (!userOnly) assert.match(fm.description, /Use (when|for)/, `${s.name}: model-invoked description needs trigger phrasing`);
  }
});

test('plugin manifest, READMEs and docs list exactly the promoted skills', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const expected = skills.map((s) => `./skills/${s.bucket}/${s.name}`).sort();
  assert.deepEqual([...plugin.skills].sort(), expected);
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(market.plugins[0].name, plugin.name);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, plugin.version, 'package.json and plugin.json versions match');
  const readme = read('README.md');
  for (const s of skills) {
    assert.ok(readme.includes(`(./skills/${s.bucket}/${s.name}/SKILL.md)`), `README links ${s.name}`);
    assert.ok(read(`skills/${s.bucket}/README.md`).includes(`(./${s.name}/SKILL.md)`), `bucket README links ${s.name}`);
    const doc = read(`docs/${s.name}.md`);
    for (const h of ['## What it does', '## When to reach for it', '## Common questions', "## It's working if"]) assert.ok(doc.includes(h), `docs/${s.name}.md: ${h}`);
  }
});

test('every file a SKILL.md links to exists', () => {
  for (const s of skills) {
    const md = fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8');
    for (const m of md.matchAll(/\]\(([^)#]+)\)/g)) if (!/^https?:/.test(m[1])) assert.ok(fs.existsSync(path.join(s.dir, m[1])), `${s.name}: missing ${m[1]}`);
    for (const m of md.matchAll(/<this skill's directory>\/([\w./-]+)/g)) assert.ok(fs.existsSync(path.join(s.dir, m[1])), `${s.name}: missing ${m[1]}`);
  }
});

test('scripts are zero-dependency and executable', () => {
  for (const s of skills) {
    const dir = path.join(s.dir, 'scripts');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.match(m[1], /^node:/, `${s.name}/${f} imports ${m[1]}`);
      assert.ok(src.startsWith('#!/usr/bin/env node'), `${s.name}/${f}: shebang`);
    }
  }
});

test('prompt budgets hold', () => {
  for (const b of budget(ROOT)) for (const p of b.parts) assert.ok(p.ok, `${b.skill}/${p.file}: ~${p.tokens} tokens > ${p.budget}`);
});
