#!/usr/bin/env node
// chaos-storm: deterministic heavy lifting for the chaos-storm skill.
// Zero dependencies, Node 18+. The agent only ever sees compact summaries.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DIR = '.chaos-storm';
export const DIMENSIONS = ['purpose', 'approach', 'focus', 'reasoning'];

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo',
  '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv', '.idea', '.vscode', DIR,
  // Agent tooling is never product code.
  '.claude', '.agents', '.codex', '.cursor', '.signal-noise',
]);
const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb',
  '.php', '.cs', '.swift', '.scala', '.vue', '.svelte', '.c', '.cc', '.cpp', '.h', '.hpp',
  '.sql', '.sh', '.ex', '.exs', '.dart', '.lua',
]);
export const DEFAULT_EXCLUDE = [
  '**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**', '**/tests/**', '**/__mocks__/**',
  '**/*.d.ts', '**/*.min.*', '**/*.gen.*', '**/generated/**', '**/migrations/**', '**/fixtures/**',
  '**/*.config.*', '**/*.stories.*',
];
const KIND_BY_PARENT = {
  apps: 'app', app: 'app', packages: 'package', libs: 'package', lib: 'package', modules: 'package',
  tools: 'tool', tooling: 'tool', scripts: 'tool', services: 'service', infra: 'infra', crates: 'package',
};
const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'project.json', 'setup.py', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile'];

// ---------- small utils ----------
export const toPosix = (p) => p.split(path.sep).join('/');
export const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'root';
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
export function matchAny(file, globs) {
  return globs.some((g) => {
    const target = g.includes('/') ? file : path.posix.basename(file);
    return globToRegExp(g).test(target);
  });
}

// Seeded PRNG so a run can be replayed exactly.
export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- file listing ----------
export function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
    const files = out.split('\n').filter(Boolean).filter((f) => !f.split('/').some((seg) => IGNORE_DIRS.has(seg)));
    if (files.length) return files.sort();
  } catch { /* not a git repo */ }
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) walk(dir ? `${dir}/${e.name}` : e.name); }
      else if (e.isFile()) files.push(dir ? `${dir}/${e.name}` : e.name);
    }
  };
  walk('');
  return files.sort();
}

const extOf = (f) => { const b = path.posix.basename(f); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };
function countExt(files) {
  const c = {};
  for (const f of files) { const e = extOf(f); if (e) c[e] = (c[e] || 0) + 1; }
  return Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]));
}

// ---------- workspace detection ----------
function workspaceGlobs(root) {
  const globs = [];
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg?.workspaces) globs.push(...(Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || []));
  const pnpm = path.join(root, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpm)) {
    for (const line of fs.readFileSync(pnpm, 'utf8').split('\n')) {
      const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/);
      if (m && !m[1].startsWith('!')) globs.push(m[1]);
    }
  }
  const lerna = readJson(path.join(root, 'lerna.json'));
  if (lerna?.packages) globs.push(...lerna.packages);
  const gowork = path.join(root, 'go.work');
  if (fs.existsSync(gowork)) {
    const txt = fs.readFileSync(gowork, 'utf8');
    for (const m of txt.matchAll(/^\s*(?:use\s+)?(\.\/[^\s)]+)/gm)) globs.push(m[1].replace(/^\.\//, ''));
  }
  const cargo = path.join(root, 'Cargo.toml');
  if (fs.existsSync(cargo)) {
    const m = fs.readFileSync(cargo, 'utf8').match(/members\s*=\s*\[([^\]]*)\]/);
    if (m) for (const s of m[1].matchAll(/"([^"]+)"/g)) globs.push(s[1]);
  }
  return [...new Set(globs.map((g) => g.replace(/\/$/, '')))];
}

function kindFor(areaPath) {
  const parts = areaPath.split('/');
  for (let i = parts.length - 2; i >= 0; i--) if (KIND_BY_PARENT[parts[i]]) return KIND_BY_PARENT[parts[i]];
  return 'module';
}

export function detectAreas(root, files) {
  const dirs = new Set(files.map((f) => path.posix.dirname(f)));
  const manifestDirs = new Set(files.filter((f) => MANIFESTS.includes(path.posix.basename(f))).map((f) => path.posix.dirname(f)).filter((d) => d !== '.'));
  const candidates = new Set();
  const globs = workspaceGlobs(root);
  for (const g of globs) {
    const re = globToRegExp(g);
    for (const d of manifestDirs) if (re.test(d)) candidates.add(d);
    for (const d of dirs) if (!g.includes('*') && d === g) candidates.add(d);
  }
  // Manifest dirs up to depth 3 are areas too (catches repos without declared workspaces).
  for (const d of manifestDirs) if (d.split('/').length <= 3) candidates.add(d);
  // Drop areas nested inside another area (keep outermost).
  const sorted = [...candidates].sort((a, b) => a.length - b.length);
  const areas = [];
  for (const d of sorted) if (!areas.some((a) => d.startsWith(a + '/'))) areas.push(d);

  const owner = (f) => areas.find((a) => f.startsWith(a + '/'));
  const byArea = Object.fromEntries(areas.map((a) => [a, []]));
  const rest = [];
  for (const f of files) { const a = owner(f); if (a) byArea[a].push(f); else rest.push(f); }

  // Unowned code: single-project repos, or loose top-level dirs in a monorepo.
  const loose = {};
  for (const f of rest) {
    if (!CODE_EXT.has(extOf(f))) continue;
    const top = f.includes('/') ? f.split('/')[0] : '.';
    (loose[top] ||= []).push(f);
  }
  const result = areas.map((a) => ({ name: a, path: a, kind: kindFor(a), files: byArea[a].length, extensions: countExt(byArea[a]), source: 'manifest' }));
  const unclassified = [];
  for (const [top, fs_] of Object.entries(loose)) {
    const entry = { name: top === '.' ? '(root)' : top, path: top, kind: top === '.' ? 'root' : (KIND_BY_PARENT[top] || 'dir'), files: fs_.length, extensions: countExt(fs_), source: 'heuristic' };
    if (areas.length && top !== '.' && !KIND_BY_PARENT[top] && !['src', 'lib', 'app'].includes(top)) unclassified.push(entry.name);
    result.push(entry);
  }
  return { areas: result, unclassified, workspaceGlobs: globs };
}

// ---------- commands ----------
export function cmdMap(root, { force = false } = {}) {
  const mapFile = path.join(root, DIR, 'map.json');
  if (fs.existsSync(mapFile) && !force) {
    const map = readJson(mapFile);
    return { status: 'exists', file: toPosix(path.relative(root, mapFile)), map };
  }
  const files = listFiles(root);
  const { areas, unclassified, workspaceGlobs: wg } = detectAreas(root, files);
  const draft = {
    version: 1,
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    workspaceGlobs: wg,
    extensions: countExt(files.filter((f) => CODE_EXT.has(extOf(f)))),
    areas: areas.map((a) => ({ ...a, include: a.files > 0 })),
    unclassified,
  };
  writeJson(path.join(root, DIR, 'map.draft.json'), draft);
  return { status: 'draft', file: `${DIR}/map.draft.json`, map: draft };
}

export function cmdConfigure(root, opts) {
  const draftFile = path.join(root, DIR, 'map.draft.json');
  const draft = readJson(draftFile) || readJson(path.join(root, DIR, 'map.json'));
  if (!draft) throw new Error(`No ${DIR}/map.draft.json. Run "map" first.`);
  const inc = (opts.include || '').split(',').map((s) => s.trim()).filter(Boolean);
  const exc = (opts.exclude_areas || '').split(',').map((s) => s.trim()).filter(Boolean);
  const exts = (opts.ext || '').split(',').map((s) => s.trim()).filter(Boolean).map((e) => (e.startsWith('.') ? e : '.' + e));
  const areas = draft.areas.map((a) => {
    let include = a.include;
    if (inc.length) include = matchAny(a.name, inc) || matchAny(a.path, inc);
    if (exc.length && (matchAny(a.name, exc) || matchAny(a.path, exc))) include = false;
    return { name: a.name, path: a.path, kind: a.kind, files: a.files, include };
  });
  const map = {
    version: 1,
    createdAt: new Date().toISOString(),
    sample: Number(opts.sample || draft.sample || 5),
    extensions: exts.length ? exts : Object.keys(draft.extensions || {}).slice(0, 3),
    exclude: opts.exclude ? opts.exclude.split(',').map((s) => s.trim()) : draft.exclude || DEFAULT_EXCLUDE,
    maxLines: Number(opts.max_lines || draft.maxLines || 400),
    minLines: Number(opts.min_lines || draft.minLines || 3),
    thresholds: draft.thresholds || { flagBelow: 3, dimensionFloor: 2 },
    models: draft.models || {
      claude: { map: 'haiku', review: 'sonnet' },
      codex: { map: 'gpt-6-luna', review: 'gpt-6-sol', effort: 'low' },
    },
    areas,
  };
  writeJson(path.join(root, DIR, 'map.json'), map);
  if (fs.existsSync(draftFile)) fs.rmSync(draftFile);
  return map;
}

const lineCount = (abs) => { try { const t = fs.readFileSync(abs, 'utf8'); return t ? t.replace(/\n$/, '').split('\n').length : 0; } catch { return 0; } };

export function cmdSelect(root, opts = {}) {
  const map = readJson(path.join(root, DIR, 'map.json'));
  if (!map) throw new Error(`No ${DIR}/map.json. Run the one-time setup first.`);
  const runId = opts.run || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const seed = opts.seed ?? runId;
  const rand = rng(seed);
  const sample = Number(opts.sample || map.sample || 5);
  const histFile = path.join(root, DIR, 'history.json');
  const history = readJson(histFile, {});
  const files = listFiles(root);
  const areas = map.areas.filter((a) => a.include && (!opts.area || a.name === opts.area));
  const owned = map.areas.filter((a) => a.path !== '.').map((a) => a.path);
  const selection = { runId, seed: String(seed), sample, maxLines: map.maxLines, createdAt: new Date().toISOString(), areas: [] };
  for (const a of areas) {
    const pool = files.filter((f) => {
      const inArea = a.path === '.' ? !f.includes('/') || !owned.some((o) => f.startsWith(o + '/')) : f.startsWith(a.path + '/');
      return inArea && map.extensions.includes(extOf(f)) && !matchAny(f, map.exclude);
    });
    // Prefer files never reviewed, then least recently reviewed; random within each tier.
    const keyed = pool.map((f) => ({ f, seen: history[f] || '', r: rand() }));
    keyed.sort((x, y) => (x.seen === y.seen ? x.r - y.r : x.seen < y.seen ? -1 : 1));
    // Trivial files (empty inits, one-line barrels) teach nothing: skip them.
    const picked = [];
    for (const { f } of keyed) {
      if (picked.length >= sample) break;
      const lines = lineCount(path.join(root, f));
      if (lines < (map.minLines ?? 3)) continue;
      picked.push({ path: f, lines, truncated: lines > map.maxLines });
    }
    selection.areas.push({ area: a.name, slug: slug(a.name), kind: a.kind, pool: pool.length, files: picked });
    for (const p of picked) history[p.path] = selection.createdAt;
  }
  const runDir = path.join(root, DIR, 'runs', runId);
  writeJson(path.join(runDir, 'selection.json'), selection);
  writeJson(histFile, history);
  return selection;
}

// ---------- import resolution (one level) ----------
const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
const stripJsonComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');

function tsPaths(root, fromFile) {
  let dir = path.dirname(path.join(root, fromFile));
  while (true) {
    for (const n of ['tsconfig.json', 'jsconfig.json']) {
      const f = path.join(dir, n);
      if (fs.existsSync(f)) {
        try {
          const cfg = JSON.parse(stripJsonComments(fs.readFileSync(f, 'utf8')));
          const co = cfg.compilerOptions || {};
          if (co.paths || co.baseUrl) return { base: path.join(dir, co.baseUrl || '.'), paths: co.paths || {} };
        } catch { /* ignore */ }
      }
    }
    if (path.resolve(dir) === path.resolve(root)) return null;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function workspacePackages(root, files) {
  const map = {};
  for (const f of files) {
    if (path.posix.basename(f) !== 'package.json' || f === 'package.json') continue;
    const pkg = readJson(path.join(root, f));
    if (pkg?.name) map[pkg.name] = { dir: path.posix.dirname(f), pkg };
  }
  return map;
}

function tryResolve(root, absNoExt, exts) {
  const rel = (p) => toPosix(path.relative(root, p));
  const cands = [absNoExt, ...exts.map((e) => absNoExt + e), ...exts.map((e) => path.join(absNoExt, 'index' + e))];
  // TS ESM style: "./x.js" that is really ./x.ts
  if (/\.(m|c)?js$/.test(absNoExt)) { const b = absNoExt.replace(/\.(m|c)?js$/, ''); cands.push(...exts.map((e) => b + e)); }
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return rel(c); } catch { /* next */ } }
  return null;
}

export function resolveDeps(root, file, ctx = {}) {
  const abs = path.join(root, file);
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); } catch { return []; }
  const ext = extOf(file);
  const out = new Set();
  if (JS_EXT.includes(ext)) {
    const specs = new Set();
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/import\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
    const ts = tsPaths(root, file);
    const pkgs = ctx.pkgs || workspacePackages(root, ctx.files || listFiles(root));
    for (const s of specs) {
      let r = null;
      if (s.startsWith('.')) r = tryResolve(root, path.resolve(path.dirname(abs), s), JS_EXT);
      if (!r && ts) {
        for (const [pat, targets] of Object.entries(ts.paths)) {
          const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)') + '$');
          const m = s.match(re);
          if (m) for (const t of targets) { r = tryResolve(root, path.join(ts.base, t.replace('*', m[1] || '')), JS_EXT); if (r) break; }
          if (r) break;
        }
        if (!r && !s.startsWith('.') && !s.startsWith('@') && ts.base) r = null; // bare specifiers stay external
      }
      if (!r) {
        const name = Object.keys(pkgs).find((n) => s === n || s.startsWith(n + '/'));
        if (name) {
          const { dir, pkg } = pkgs[name];
          const sub = s.slice(name.length).replace(/^\//, '');
          const entry = sub || (typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']?.import || pkg.exports?.['.']?.default || (typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : null)) || pkg.source || pkg.main || 'src/index';
          r = tryResolve(root, path.join(root, dir, entry), JS_EXT) || tryResolve(root, path.join(root, dir, 'src', sub || 'index'), JS_EXT);
        }
      }
      if (r && r !== file) out.add(r);
    }
  } else if (ext === '.py') {
    const base = path.dirname(abs);
    for (const m of src.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import\s+([\w, ]+)/gm)) {
      let dir = base;
      for (let i = 1; i < m[1].length; i++) dir = path.dirname(dir);
      const mod = m[2] ? path.join(dir, ...m[2].split('.')) : dir;
      const r = tryResolve(root, mod, ['.py']) || tryResolve(root, path.join(mod, '__init__'), ['.py']);
      if (r && m[2]) out.add(r);
      if (!m[2]) for (const n of m[3].split(',').map((x) => x.trim()).filter(Boolean)) { const rr = tryResolve(root, path.join(dir, n), ['.py']); if (rr) out.add(rr); }
    }
    for (const m of src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] || m[2]).split('.');
      for (const b of [root, path.join(root, 'src')]) {
        const r = tryResolve(root, path.join(b, ...mod), ['.py']) || tryResolve(root, path.join(b, ...mod, '__init__'), ['.py']);
        if (r) { out.add(r); break; }
      }
    }
  } else {
    // Generic: quoted relative paths (C includes, shell sources, etc.)
    for (const m of src.matchAll(/["'](\.{1,2}\/[^"'\s]+)["']/g)) {
      const r = tryResolve(root, path.resolve(path.dirname(abs), m[1]), [ext]);
      if (r && r !== file) out.add(r);
    }
  }
  return [...out].sort();
}

// ---------- scoring ----------
export function fileScore(f) { return round(mean(DIMENSIONS.map((d) => Number(f.scores?.[d] || 0)))); }
export function isFlagged(f, t = { flagBelow: 3, dimensionFloor: 2 }) {
  return fileScore(f) < t.flagBelow || DIMENSIONS.some((d) => Number(f.scores?.[d] || 0) <= t.dimensionFloor);
}
export function grade(score) { return score >= 4.5 ? 'A' : score >= 3.75 ? 'B' : score >= 3 ? 'C' : score >= 2.25 ? 'D' : 'E'; }

export function validateReview(obj, { escalated = false } = {}) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return ['not a JSON object'];
  if (!obj.area) errors.push('missing "area"');
  if (!Array.isArray(obj.files) || !obj.files.length) errors.push('"files" must be a non-empty array');
  for (const [i, f] of (obj.files || []).entries()) {
    const at = `files[${i}]${f?.path ? ` (${f.path})` : ''}`;
    if (!f.path) errors.push(`${at}: missing path`);
    for (const k of ['purpose', 'how']) if (!f[k] || typeof f[k] !== 'string') errors.push(`${at}: missing "${k}" sentence`);
    if (!Array.isArray(f.outside)) errors.push(`${at}: "outside" must be an array (empty if nothing)`);
    for (const d of DIMENSIONS) {
      const v = f.scores?.[d];
      if (!Number.isInteger(v) || v < 1 || v > 5) errors.push(`${at}: scores.${d} must be an integer 1-5`);
    }
    if (escalated && !['cleared', 'concern'].includes(f.verdict)) errors.push(`${at}: verdict must be "cleared" or "concern"`);
    if (escalated && f.verdict === 'concern' && !f.action) errors.push(`${at}: concern needs an "action"`);
  }
  return errors;
}

function loadRun(root, runId) {
  const runsDir = path.join(root, DIR, 'runs');
  const id = runId || (fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort().pop() : null);
  if (!id) throw new Error('No runs found. Run "select" first.');
  const dir = path.join(runsDir, id);
  const selection = readJson(path.join(dir, 'selection.json'));
  if (!selection) throw new Error(`Run ${id} has no selection.json`);
  const map = readJson(path.join(root, DIR, 'map.json')) || {};
  return { id, dir, selection, map, thresholds: map.thresholds || { flagBelow: 3, dimensionFloor: 2 } };
}

export function cmdValidate(root, runId) {
  const { dir } = loadRun(root, runId);
  const rdir = path.join(dir, 'reviews');
  const problems = {};
  for (const f of fs.existsSync(rdir) ? fs.readdirSync(rdir).filter((x) => x.endsWith('.json')) : []) {
    const errs = validateReview(readJson(path.join(rdir, f)), { escalated: f.endsWith('.escalated.json') });
    if (errs.length) problems[f] = errs;
  }
  return problems;
}

export function cmdEscalate(root, runId) {
  const { id, dir, selection, thresholds } = loadRun(root, runId);
  const files = listFiles(root);
  const ctx = { files, pkgs: workspacePackages(root, files) };
  const items = [];
  for (const a of selection.areas) {
    const review = readJson(path.join(dir, 'reviews', `${a.slug}.json`));
    if (!review) continue;
    for (const f of review.files) {
      if (!isFlagged(f, thresholds)) continue;
      items.push({ area: a.area, slug: a.slug, path: f.path, score: fileScore(f), deps: resolveDeps(root, f.path, ctx) });
    }
  }
  const esc = { runId: id, items };
  writeJson(path.join(dir, 'escalation.json'), esc);
  return esc;
}

export function cmdReport(root, runId) {
  const { id, dir, selection, thresholds } = loadRun(root, runId);
  const report = { runId: id, seed: selection.seed, createdAt: new Date().toISOString(), thresholds, areas: [], concerns: [], missing: [] };
  for (const a of selection.areas) {
    const review = readJson(path.join(dir, 'reviews', `${a.slug}.json`));
    const escal = readJson(path.join(dir, 'reviews', `${a.slug}.escalated.json`));
    if (!review) { report.missing.push(a.area); continue; }
    const escBy = Object.fromEntries((escal?.files || []).map((f) => [f.path, f]));
    const files = review.files.map((f) => {
      const e = escBy[f.path];
      const flagged = isFlagged(f, thresholds);
      const final = e ? e : f;
      const status = !flagged ? 'ok' : !e ? 'flagged-unescalated' : e.verdict === 'cleared' && !isFlagged(e, thresholds) ? 'cleared' : 'concern';
      return { path: f.path, purpose: f.purpose, how: f.how, outside: f.outside, scores: f.scores, score: fileScore(f), finalScore: fileScore(final), escalated: Boolean(e), deps: e?.deps || [], status, action: e?.action || null, notes: e?.notes || f.notes || '' };
    });
    const score = round(mean(files.map((f) => f.finalScore)));
    const dims = Object.fromEntries(DIMENSIONS.map((d) => [d, round(mean(files.map((f) => f.scores[d])))]));
    report.areas.push({ area: a.area, kind: a.kind, pool: a.pool, score, grade: grade(score), dims, files });
    for (const f of files) if (f.status === 'concern' || f.status === 'flagged-unescalated') report.concerns.push({ area: a.area, path: f.path, score: f.finalScore, status: f.status, action: f.action || f.notes });
  }
  const all = report.areas.flatMap((a) => a.files.map((f) => f.finalScore));
  report.score = round(mean(all));
  report.grade = grade(report.score);
  writeJson(path.join(dir, 'report.json'), report);
  fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(report));
  return report;
}

export function renderMarkdown(r) {
  const L = [];
  L.push(`# Chaos Storm report: ${r.runId}`, '');
  L.push(`Overall **${r.grade}** (${r.score}/5) across ${r.areas.length} areas. Seed \`${r.seed}\`. Concerns: **${r.concerns.length}**.`, '');
  L.push('Scores (1-5): **purpose** what is it trying to do, **approach** how is it doing it, **focus** nothing outside its purpose, **reasoning** can it be reasoned with.', '');
  if (r.concerns.length) {
    L.push('## Concerns to action', '', '| Area | File | Score | Action |', '|---|---|---|---|');
    for (const c of r.concerns) L.push(`| ${c.area} | \`${c.path}\` | ${c.score} | ${(c.action || '').replace(/\|/g, '/')}${c.status === 'flagged-unescalated' ? ' (not escalated)' : ''} |`);
    L.push('');
  }
  L.push('## Areas', '', '| Area | Grade | Score | Purpose | Approach | Focus | Reasoning |', '|---|---|---|---|---|---|---|');
  for (const a of r.areas) L.push(`| ${a.area} | ${a.grade} | ${a.score} | ${a.dims.purpose} | ${a.dims.approach} | ${a.dims.focus} | ${a.dims.reasoning} |`);
  for (const a of r.areas) {
    L.push('', `### ${a.area} (${a.kind}) ${a.grade}`, '');
    for (const f of a.files) {
      const s = f.scores;
      const tag = { ok: '', cleared: ' · cleared after dependency review', concern: ' · **CONCERN**', 'flagged-unescalated': ' · flagged, not escalated' }[f.status];
      L.push(`- \`${f.path}\` **${f.finalScore}** [P${s.purpose} A${s.approach} F${s.focus} R${s.reasoning}]${tag}`);
      L.push(`  - What: ${f.purpose}`, `  - How: ${f.how}`);
      if (f.outside?.length) L.push(`  - Outside purpose: ${f.outside.join('; ')}`);
      if (f.escalated) L.push(`  - Deps reviewed: ${f.deps.length ? f.deps.map((d) => `\`${d}\``).join(', ') : 'none resolved'}`);
      if (f.action) L.push(`  - Action: ${f.action}`);
    }
  }
  if (r.missing.length) L.push('', `Missing reviews: ${r.missing.join(', ')}`);
  return L.join('\n') + '\n';
}

// ---------- CLI ----------
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const key = k.replace(/-/g, '_');
      if (v !== undefined) opts[key] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
      else opts[key] = true;
    } else opts._.push(a);
  }
  return opts;
}

const HELP = `chaos-storm <command> [--root DIR]
  map [--force]                 scan repo -> .chaos-storm/map.draft.json (or report existing map.json)
  configure --include a,b --ext .ts,.tsx [--sample 5] [--exclude-areas x] [--max-lines 400]
  select [--seed S] [--sample N] [--area NAME]   pick random files per area -> runs/<id>/selection.json
  deps <file>                   local imports of <file>, one level
  validate [--run ID]           check reviews/*.json against the schema
  escalate [--run ID]           flagged files + their deps -> runs/<id>/escalation.json
  report [--run ID]             merge reviews -> runs/<id>/report.md + report.json`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const root = path.resolve(opts.root || process.cwd());
  const say = (s) => process.stdout.write(s + '\n');
  switch (cmd) {
    case 'map': {
      const r = cmdMap(root, { force: opts.force });
      if (r.status === 'exists') {
        const inc = r.map.areas.filter((a) => a.include);
        say(`map exists: ${r.file} | ${inc.length}/${r.map.areas.length} areas included | ext ${r.map.extensions.join(',')} | sample ${r.map.sample}`);
        break;
      }
      const m = r.map;
      say(`draft: ${r.file} | ${m.totalFiles} files | workspaces: ${m.workspaceGlobs.join(', ') || 'none'}`);
      say(`code ext: ${Object.entries(m.extensions).slice(0, 8).map(([e, n]) => `${e}:${n}`).join(' ')}`);
      say('areas (name | kind | files | top ext):');
      for (const a of m.areas) say(`  ${a.name} | ${a.kind} | ${a.files} | ${Object.keys(a.extensions).slice(0, 3).join(',')}`);
      if (m.unclassified.length) say(`unclassified: ${m.unclassified.join(', ')}`);
      break;
    }
    case 'configure': {
      const m = cmdConfigure(root, opts);
      say(`wrote ${DIR}/map.json | included: ${m.areas.filter((a) => a.include).map((a) => a.name).join(', ')} | ext ${m.extensions.join(',')} | sample ${m.sample}`);
      break;
    }
    case 'select': {
      const s = cmdSelect(root, opts);
      say(`run ${s.runId} seed=${s.seed} maxLines=${s.maxLines}`);
      for (const a of s.areas) say(`${a.area} [${a.slug}] (${a.files.length}/${a.pool}): ${a.files.map((f) => `${f.path}:${f.lines}${f.truncated ? '!' : ''}`).join(' ') || '(no matching files)'}`);
      break;
    }
    case 'deps': {
      const f = opts._[1];
      if (!f) throw new Error('usage: deps <file>');
      say(resolveDeps(root, toPosix(f)).join('\n') || '(no local imports)');
      break;
    }
    case 'validate': {
      const p = cmdValidate(root, opts.run);
      const keys = Object.keys(p);
      if (!keys.length) say('valid');
      else { for (const k of keys) say(`${k}:\n  ${p[k].join('\n  ')}`); process.exitCode = 1; }
      break;
    }
    case 'escalate': {
      const e = cmdEscalate(root, opts.run);
      say(`run ${e.runId}: ${e.items.length} flagged`);
      for (const it of e.items) say(`${it.slug} ${it.path} (${it.score}) deps: ${it.deps.join(' ') || 'none'}`);
      break;
    }
    case 'report': {
      const r = cmdReport(root, opts.run);
      say(`report: ${DIR}/runs/${r.runId}/report.md | overall ${r.grade} (${r.score}) | concerns ${r.concerns.length}`);
      for (const a of r.areas) say(`  ${a.area}: ${a.grade} (${a.score})`);
      for (const c of r.concerns) say(`  CONCERN ${c.path}: ${c.action || ''}`);
      if (r.missing.length) say(`  missing reviews: ${r.missing.join(', ')}`);
      break;
    }
    default:
      say(HELP);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (e) { process.stderr.write(`chaos-storm: ${e.message}\n`); process.exitCode = 1; }
}
