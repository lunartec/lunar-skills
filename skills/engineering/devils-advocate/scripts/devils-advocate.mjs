#!/usr/bin/env node
// devils-advocate: builds a compact evidence brief for a target and validates/renders the challenge.
// Zero dependencies, Node 18+.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DIR = '.devils-advocate';
export const LENSES = ['overengineering', 'duplication', 'new-pattern', 'premise', 'risk', 'review-gap'];
export const LEVELS = ['low', 'med', 'high'];
export const VERDICTS = ['proceed', 'adjust', 'rethink'];
const MAX_CHALLENGES = 5;

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const trySh = (cmd, args, cwd) => { try { return sh(cmd, args, cwd); } catch { return null; } };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'target';
const IGNORE = /(^|\/)(node_modules|dist|build|\.git|\.next|coverage|vendor|target|\.claude|\.agents|\.codex|\.devils-advocate|\.chaos-storm|\.signal-noise)(\/|$)/;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala|vue|svelte)$/;

// ---------- target resolution ----------
export function resolveTarget(root, spec, base) {
  if (!spec) throw new Error('usage: target <file|dir|branch|#pr|a..b> [--base main]');
  const abs = path.resolve(root, spec);
  if (fs.existsSync(abs)) return { kind: fs.statSync(abs).isDirectory() ? 'dir' : 'file', label: spec, path: path.relative(root, abs) || '.' };
  const pr = spec.match(/^#?(\d+)$/);
  if (pr) return { kind: 'pr', label: `PR #${pr[1]}`, pr: pr[1] };
  if (spec.includes('..')) { const [a, b] = spec.split(/\.\.\.?/); return { kind: 'range', label: spec, base: a, head: b || 'HEAD' }; }
  if (trySh('git', ['rev-parse', '--verify', '--quiet', spec], root)) {
    const b = base || defaultBase(root);
    return { kind: 'branch', label: spec, base: b, head: spec };
  }
  throw new Error(`cannot resolve target "${spec}" as a path, PR number, branch or range`);
}

function defaultBase(root) {
  for (const b of ['origin/main', 'main', 'origin/master', 'master', 'develop']) if (trySh('git', ['rev-parse', '--verify', '--quiet', b], root)) return b;
  return 'HEAD~1';
}

function listRepoFiles(root) {
  const out = trySh('git', ['ls-files', '-co', '--exclude-standard'], root);
  if (out) return out.split('\n').filter((f) => f && !IGNORE.test(f));
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = d ? `${d}/${e.name}` : e.name; if (IGNORE.test(p)) continue; if (e.isDirectory()) walk(p); else files.push(p); } };
  walk('');
  return files;
}

// Parse a unified diff into per-file added lines.
export function parseDiff(diff) {
  const files = [];
  let cur = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { cur = { path: line.split(' b/').pop(), status: 'modified', added: [], removed: 0 }; files.push(cur); continue; }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('@@')) { const m = line.match(/\+(\d+)/); lineNo = m ? Number(m[1]) : 0; }
    else if (line.startsWith('+') && !line.startsWith('+++')) { cur.added.push({ n: lineNo, text: line.slice(1) }); lineNo++; }
    else if (line.startsWith('-') && !line.startsWith('---')) cur.removed++;
    else if (!line.startsWith('\\')) lineNo++;
  }
  return files;
}

function diffFor(root, t) {
  if (t.kind === 'pr') {
    const d = trySh('gh', ['pr', 'diff', t.pr], root);
    if (d == null) throw new Error('gh pr diff failed: is gh installed and authenticated?');
    const meta = trySh('gh', ['pr', 'view', t.pr, '--json', 'title,body,baseRefName,headRefName'], root);
    if (meta) { const m = JSON.parse(meta); t.title = m.title; t.description = (m.body || '').slice(0, 1500); t.base = m.baseRefName; t.head = m.headRefName; }
    return d;
  }
  const mb = trySh('git', ['merge-base', t.base, t.head], root)?.trim() || t.base;
  t.log = (trySh('git', ['log', '--format=%s', `${mb}..${t.head}`], root) || '').trim().split('\n').filter(Boolean).slice(0, 15);
  return sh('git', ['diff', '--no-color', '-U0', `${mb}..${t.head}`], root);
}

// ---------- heuristics ----------
const EXPORT_RE = [
  /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^class\s+([A-Za-z_]\w*)/, /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*pub\s+(?:fn|struct|trait|enum)\s+([A-Za-z_]\w*)/,
];
const ABSTRACTION_RE = /\b(interface\s+I?[A-Z]\w*|abstract\s+class|\w*(Factory|Strategy|Provider|Registry|Manager|Builder|Adapter|Handler|Base|Service)\b|implements\s+\w+|<[A-Z]\w*(\s+extends\s+[^>]+)?>)/;
const DEP_FILES = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile)$/;

const stem = (f) => path.posix.basename(f).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '').toLowerCase();
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().split(' ').filter((w) => w.length > 2 && !['get', 'set', 'the', 'and', 'for', 'new', 'create', 'make', 'impl', 'base', 'default', 'factory', 'service', 'manager', 'provider', 'handler', 'util', 'utils', 'helper', 'helpers', 'interface', 'type', 'index', 'main', 'mod', 'lib', 'src'].includes(w));

export function buildBrief(root, t, files) {
  const repo = listRepoFiles(root);
  const changed = new Set(files.map((f) => f.path));
  const others = repo.filter((f) => !changed.has(f) && CODE.test(f));
  const exports = [];
  let abstractions = 0;
  const newDeps = [];
  for (const f of files) {
    for (const l of f.added) {
      for (const re of EXPORT_RE) { const m = l.text.match(re); if (m) { exports.push({ name: m[1], at: `${f.path}:${l.n}` }); break; } }
      if (CODE.test(f.path) && ABSTRACTION_RE.test(l.text)) abstractions++;
      if (DEP_FILES.test(f.path)) { const m = l.text.match(/^\s*"?([@\w./-]+)"?\s*[:=<>~^]/); if (m && !/^(version|name|description|scripts|main|private|type)$/.test(m[1])) newDeps.push(`${m[1]} (${f.path})`); }
    }
  }
  // Duplicate hints: other files sharing a meaningful word with a new export or new file name.
  const index = others.map((f) => ({ f, w: new Set(words(path.posix.basename(f).replace(/\.[^.]+$/, ''))) }));
  const dupHints = [];
  const seen = new Set();
  const probes = [...exports.map((e) => ({ name: e.name, at: e.at })), ...files.filter((f) => f.status === 'added').map((f) => ({ name: stem(f.path), at: f.path }))];
  for (const p of probes) {
    const ws = words(p.name);
    if (!ws.length) continue;
    const hits = [];
    for (const { f, w } of index) if (ws.some((x) => w.has(x))) hits.push(f);
    const grep = trySh('git', ['grep', '-l', '-i', '-E', `(function|def|class|func|fn|export\\s+const)\\s+\\w*(${ws.join('|')})`, '--', '.'], root);
    for (const g of (grep || '').split('\n').filter(Boolean)) if (!changed.has(g) && !IGNORE.test(g) && CODE.test(g)) hits.push(g);
    const uniq = [...new Set(hits)].slice(0, 4);
    const key = `${p.name}|${uniq.join()}`;
    if (uniq.length && !seen.has(key)) { seen.add(key); dupHints.push({ probe: p.name, at: p.at, similar: uniq }); }
  }
  const addedLoc = files.reduce((a, f) => a + f.added.length, 0);
  const newFiles = files.filter((f) => f.status === 'added');
  const isDiff = !['file', 'dir'].includes(t.kind);
  return {
    version: 1,
    target: { kind: t.kind, label: t.label, base: t.base || null, head: t.head || null, title: t.title || null, description: t.description || null, log: t.log || [] },
    createdAt: new Date().toISOString(),
    totals: { files: files.length, added: addedLoc, removed: files.reduce((a, f) => a + f.removed, 0), newFiles: isDiff ? newFiles.length : 0 },
    files: files.map((f) => ({ path: f.path, status: f.status, added: f.added.length, removed: f.removed })),
    signals: {
      abstractionLines: abstractions,
      abstractionPer100Loc: addedLoc ? Math.round((abstractions / addedLoc) * 1000) / 10 : 0,
      tinyNewFiles: isDiff ? newFiles.filter((f) => f.added.length > 0 && f.added.length < 15).map((f) => f.path) : [],
      newDirs: isDiff ? [...new Set(newFiles.map((f) => path.posix.dirname(f.path)).filter((d) => !repo.some((r) => !changed.has(r) && r.startsWith(d + '/'))))] : [],
      newDeps,
    },
    exports: exports.slice(0, 30),
    dupHints: dupHints.slice(0, 12),
  };
}

export function cmdTarget(root, spec, opts = {}) {
  const t = resolveTarget(root, spec, opts.base);
  let files;
  if (t.kind === 'file' || t.kind === 'dir') {
    const all = listRepoFiles(root).filter((f) => t.kind === 'file' ? f === t.path : t.path === '.' || f.startsWith(t.path + '/'));
    files = all.filter((f) => CODE.test(f) || t.kind === 'file').map((f) => {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      return { path: f, status: 'added', added: text.split('\n').map((x, i) => ({ n: i + 1, text: x })), removed: 0 };
    });
  } else files = parseDiff(diffFor(root, t));
  const brief = buildBrief(root, t, files);
  const slug = opts.slug ? slugify(opts.slug) : slugify(t.label);
  brief.slug = slug;
  writeJson(path.join(root, DIR, slug, 'brief.json'), brief);
  return brief;
}

export function renderBriefText(b) {
  const L = [`brief ${DIR}/${b.slug}/brief.json | ${b.target.kind} ${b.target.label}${b.target.base ? ` vs ${b.target.base}` : ''}`];
  L.push(['file', 'dir'].includes(b.target.kind) ? `${b.totals.files} files, ${b.totals.added} lines` : `${b.totals.files} files, +${b.totals.added}/-${b.totals.removed}, ${b.totals.newFiles} new`);
  if (b.target.title) L.push(`title: ${b.target.title}`);
  if (b.target.log.length) L.push(`commits: ${b.target.log.slice(0, 5).join(' | ')}`);
  L.push(`abstraction density: ${b.signals.abstractionPer100Loc}/100 LOC${b.signals.tinyNewFiles.length ? ` | tiny new files: ${b.signals.tinyNewFiles.length}` : ''}${b.signals.newDirs.length ? ` | new dirs: ${b.signals.newDirs.join(', ')}` : ''}`);
  if (b.signals.newDeps.length) L.push(`new deps: ${b.signals.newDeps.join(', ')}`);
  for (const d of b.dupHints.slice(0, 8)) L.push(`dup? ${d.probe} (${d.at}) ~ ${d.similar.join(', ')}`);
  return L.join('\n');
}

// ---------- challenge validation + rendering ----------
const SCORE = { low: 1, med: 2, high: 3 };
export function validateChallenge(c) {
  const e = [];
  if (!c || typeof c !== 'object') return ['not a JSON object'];
  if (!c.understanding || String(c.understanding).split(/\s+/).length < 8) e.push('"understanding": state the current position being challenged (one paragraph)');
  if (!VERDICTS.includes(c.verdict)) e.push(`"verdict" must be ${VERDICTS.join('|')}`);
  if (!Array.isArray(c.challenges) || !c.challenges.length) e.push('"challenges" must be a non-empty array');
  else if (c.challenges.length > MAX_CHALLENGES) e.push(`${c.challenges.length} challenges: keep the strongest ${MAX_CHALLENGES}`);
  (c.challenges || []).forEach((x, i) => {
    const at = `challenges[${i}]`;
    if (!LENSES.includes(x.lens)) e.push(`${at}: "lens" must be ${LENSES.join('|')}`);
    for (const k of ['claim', 'steelman', 'question', 'alternative']) if (!x[k]) e.push(`${at}: missing "${k}"`);
    if (!Array.isArray(x.evidence) || !x.evidence.length) e.push(`${at}: "evidence" needs at least one path:line or concrete fact`);
    for (const k of ['confidence', 'consequence']) if (!LEVELS.includes(x[k])) e.push(`${at}: "${k}" must be ${LEVELS.join('|')}`);
  });
  if (!Array.isArray(c.wouldChangeMind) || !c.wouldChangeMind.length) e.push('"wouldChangeMind": what evidence would make the current approach right');
  if (c.verdict === 'proceed' && (c.challenges || []).some((x) => x.confidence === 'high' && x.consequence === 'high')) e.push('verdict "proceed" contradicts a high-confidence, high-consequence challenge');
  return e;
}

export function renderReport(b, c) {
  const ranked = [...c.challenges].sort((x, y) => SCORE[y.confidence] * SCORE[y.consequence] - SCORE[x.confidence] * SCORE[x.consequence]);
  const L = [`# Devil's advocate: ${b?.target.label || c.target || 'target'}`, ''];
  L.push(`**Verdict: ${c.verdict.toUpperCase()}**${c.voice ? ` · voice: ${c.voice}` : ''}`, '');
  L.push('## The current position', '', c.understanding, '');
  L.push('## Challenges', '');
  ranked.forEach((x, i) => {
    L.push(`### ${i + 1}. ${x.claim}`, '', `Lens: **${x.lens}** · confidence **${x.confidence}** · consequence if right **${x.consequence}**`, '');
    L.push(`- Evidence: ${x.evidence.map((v) => (/^[\w./-]+:\d+/.test(v) ? `\`${v}\`` : v)).join('; ')}`);
    L.push(`- Strongest case for the current approach: ${x.steelman}`);
    L.push(`- Question for you: ${x.question}`);
    L.push(`- Alternative: ${x.alternative}`, '');
  });
  L.push('## What would change my mind', '', ...c.wouldChangeMind.map((w) => `- ${w}`), '');
  L.push('_A deliberately opposing voice. It argues the other side so you can decide with both in view; it is not a verdict on the author._', '');
  return L.join('\n');
}

export function cmdRender(root, slug) {
  const dir = path.join(root, DIR, slug);
  const c = readJson(path.join(dir, 'challenge.json'));
  const errors = validateChallenge(c);
  if (errors.length) return { errors };
  let b = null;
  try { b = readJson(path.join(dir, 'brief.json')); } catch { /* commentary-only targets have no brief */ }
  const md = renderReport(b, c);
  fs.writeFileSync(path.join(dir, 'report.md'), md);
  return { errors: [], challenge: c, file: `${DIR}/${slug}/report.md` };
}

// ---------- CLI ----------
const HELP = `devils-advocate <command>
  target <file|dir|branch|#pr|a..b> [--base main] [--slug s]   evidence brief -> ${DIR}/<slug>/brief.json
  render <slug>                                                  validate challenge.json -> report.md`;

function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const base = opt('base');
  const slug = opt('slug');
  const [cmd, arg] = argv;
  const root = process.cwd();
  const say = (s) => process.stdout.write(s + '\n');
  if (cmd === 'target') say(renderBriefText(cmdTarget(root, arg, { base, slug })));
  else if (cmd === 'render') {
    if (!arg) throw new Error('usage: render <slug>');
    const r = cmdRender(root, arg);
    if (r.errors.length) { for (const e of r.errors) say(`error: ${e}`); process.exitCode = 1; return; }
    const top = r.challenge.challenges.map((x) => `${x.lens}: ${x.claim}`);
    say(`${r.file} | verdict ${r.challenge.verdict} | ${top.length} challenges`);
    for (const t of top) say(`  - ${t}`);
  } else { say(HELP); if (cmd && cmd !== 'help') process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (e) { process.stderr.write(`devils-advocate: ${e.message}\n`); process.exitCode = 1; }
}
