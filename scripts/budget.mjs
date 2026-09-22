#!/usr/bin/env node
// Prompt budget: estimates tokens for every SKILL.md and the prompts it hands to subagents.
// Lean skills are a feature; this keeps them lean. Heuristic: ~3.8 chars per token for English + markdown.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGETS = { skill: 1200, prompt: 800 };
export const estimateTokens = (text) => Math.ceil(text.length / 3.8);

export function listSkills(root = ROOT) {
  const out = [];
  const base = path.join(root, 'skills');
  for (const bucket of fs.readdirSync(base, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    for (const s of fs.readdirSync(path.join(base, bucket.name), { withFileTypes: true })) {
      const dir = path.join(base, bucket.name, s.name);
      if (s.isDirectory() && fs.existsSync(path.join(dir, 'SKILL.md'))) out.push({ bucket: bucket.name, name: s.name, dir });
    }
  }
  return out;
}

export function budget(root = ROOT) {
  return listSkills(root).map((s) => {
    const files = fs.readdirSync(s.dir).filter((f) => f.endsWith('.md'));
    const parts = files.map((f) => {
      const tokens = estimateTokens(fs.readFileSync(path.join(s.dir, f), 'utf8'));
      const kind = f === 'SKILL.md' ? 'skill' : 'prompt';
      return { file: f, kind, tokens, budget: BUDGETS[kind], ok: tokens <= BUDGETS[kind] };
    }).sort((a, b) => (a.kind === 'skill' ? -1 : b.kind === 'skill' ? 1 : a.file.localeCompare(b.file)));
    return { skill: s.name, bucket: s.bucket, parts, ok: parts.every((p) => p.ok) };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rows = budget();
  for (const r of rows) {
    console.log(`${r.ok ? 'ok  ' : 'OVER'} ${r.skill}`);
    for (const p of r.parts) console.log(`     ${p.file.padEnd(14)} ~${String(p.tokens).padStart(5)} / ${p.budget} tokens ${p.ok ? '' : '  <-- over budget'}`);
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}
