#!/usr/bin/env node
// signal-noise: enforces the 3-5 signal rule, writes the ledger and the noise handoff.
// Zero dependencies, Node 18+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR = '.signal-noise';
export const CLASSES = ['signal', 'noise', 'cut'];
export const MAX_SIGNAL = 5;
export const VERDICTS = ['done', 'later', 'drop'];

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'plan';
const clip = (s) => String(s).replace(/[.\s]+$/, '');
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

export function validate(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== 'object') return { errors: ['input must be a JSON object'], warnings };
  if (!input.goal || words(input.goal) < 3) errors.push('"goal": one sentence naming the outcome this session must produce');
  if (!Array.isArray(input.items) || !input.items.length) errors.push('"items" must be a non-empty array');
  const items = input.items || [];
  items.forEach((it, i) => {
    const at = `items[${i}]`;
    if (!it.text) errors.push(`${at}: missing "text"`);
    if (!CLASSES.includes(it.class)) errors.push(`${at}: "class" must be one of ${CLASSES.join('|')}`);
    if (!it.reason) errors.push(`${at}: missing "reason" (why it is or is not on the critical path)`);
    else if (words(it.reason) > 25) warnings.push(`${at}: reason over 25 words; tighten it`);
    if (it.effort !== undefined && !(Number.isInteger(it.effort) && it.effort >= 1 && it.effort <= 5)) errors.push(`${at}: "effort" must be an integer 1-5`);
    if (words(it.text) > 16) warnings.push(`${at}: text over 16 words; atomise it`);
  });
  const signal = items.filter((i) => i.class === 'signal');
  if (items.length && !signal.length) errors.push('no signal items: at least one thing must matter');
  if (signal.length > MAX_SIGNAL) errors.push(`${signal.length} signal items: max ${MAX_SIGNAL}. Rank by goal impact x unblocking and demote the rest to noise`);
  if (items.length >= 6 && signal.length / items.length > 0.6) warnings.push('over 60% of items are signal: the test is being applied too generously');
  if (items.length && items.length < 4) warnings.push('fewer than 4 items: little to trim, consider skipping signal-noise');
  return { errors, warnings };
}

export function buildLedger(input) {
  const counters = { signal: 0, noise: 0, cut: 0 };
  const prefix = { signal: 'S', noise: 'N', cut: 'C' };
  const items = input.items.map((it) => {
    const id = `${prefix[it.class]}${++counters[it.class]}`;
    return { id, text: it.text.trim(), class: it.class, reason: it.reason.trim(), effort: it.effort || 2, status: it.class === 'signal' ? 'todo' : it.class === 'noise' ? 'queued' : 'cut', note: null };
  });
  const effort = (c) => items.filter((i) => i.class === c).reduce((a, i) => a + i.effort, 0);
  const kept = effort('signal') + effort('noise');
  return {
    version: 1,
    slug: input.slug ? slugify(input.slug) : slugify(input.goal),
    goal: input.goal.trim(),
    horizon: input.horizon || 'this session',
    mode: input.mode || 'plan',
    createdAt: new Date().toISOString(),
    stats: {
      signal: counters.signal, noise: counters.noise, cut: counters.cut,
      signalEffort: effort('signal'), noiseEffort: effort('noise'), cutEffort: effort('cut'),
      // Share of the kept work that stays with the main agent. Target >= 0.8 of main-agent tokens,
      // which holds by construction because noise is delegated; this ratio shows how much was delegated.
      focus: kept ? Math.round((effort('signal') / kept) * 100) / 100 : 1,
    },
    items,
  };
}

export function card(l) {
  const s = l.stats;
  const out = [`SIGNAL | goal: ${l.goal} | horizon: ${l.horizon}`];
  out.push(`${s.signal} signal, ${s.noise} noise -> quick pass, ${s.cut} cut | signal share of kept effort ${Math.round(s.focus * 100)}%`);
  for (const i of l.items.filter((x) => x.class === 'signal')) out.push(`${i.status === 'done' ? '[x]' : '[ ]'} ${i.id} ${i.text}`);
  if (s.noise) out.push(`noise handoff: ${DIR}/${l.slug}.handoff.md`);
  return out.join('\n');
}

export function renderMarkdown(l) {
  const L = [`# Signal / Noise: ${l.goal}`, '', `Horizon: ${l.horizon}. Mode: ${l.mode}. Created ${l.createdAt.slice(0, 16).replace('T', ' ')}.`, ''];
  const section = (title, cls, fmt) => {
    const xs = l.items.filter((i) => i.class === cls);
    if (!xs.length) return;
    L.push(`## ${title}`, '');
    for (const i of xs) L.push(fmt(i));
    L.push('');
  };
  section('Signal (main agent, 80%)', 'signal', (i) => `- [${i.status === 'done' ? 'x' : ' '}] **${i.id}** ${clip(i.text)} _(effort ${i.effort})_: ${i.reason}`);
  section('Noise (quick pass, review later)', 'noise', (i) => `- **${i.id}** ${clip(i.text)}: ${i.reason}${i.note ? `\n  - Quick pass: **${i.note.verdict}** ${i.note.text}` : '\n  - Quick pass: pending'}`);
  section('Cut', 'cut', (i) => `- ~~${i.id} ${clip(i.text)}~~: ${i.reason}`);
  return L.join('\n');
}

export function renderHandoff(l) {
  const noise = l.items.filter((i) => i.class === 'noise');
  const script = 'node <signal-noise skill dir>/scripts/signal-noise.mjs';
  return [
    `# Quick pass: noise for "${l.goal}"`,
    '',
    'The main agent set these items aside because the goal does not need them now. That is settled; do not re-argue it.',
    'Your question is different: is each worth doing at all, and can you cheaply get it started? Spend little. For each item:',
    '',
    '1. Take one quick look (a few files or minutes of thought at most). Do not edit project source files; the main agent owns the tree.',
    `2. Where a cheap head start would save real time later (an outline, checklist, stub doc, test sketch), write it under \`${DIR}/${l.slug}.drafts/\`.`,
    `3. Record one verdict: \`${script} note ${l.slug} <id> <done|later|drop> "<=30 words"\``,
    '   - `done`: fully handled by your draft or a trivial check. `later`: worth doing once the goal lands; say what and point to any draft. `drop`: not worth doing ever; say why.',
    '   - When unsure between `later` and `drop`, choose `later`.',
    '',
    'Items:',
    '',
    ...noise.map((i) => `- ${i.id}: ${i.text} (${i.reason})`),
    '',
    'Reply with one line only: `OK <n> noted`.',
    '',
  ].join('\n');
}

const ledgerPath = (root, slug) => path.join(root, DIR, `${slug}.json`);
function save(root, l) {
  writeJson(ledgerPath(root, l.slug), l);
  fs.writeFileSync(path.join(root, DIR, `${l.slug}.md`), renderMarkdown(l));
  if (l.items.some((i) => i.class === 'noise')) fs.writeFileSync(path.join(root, DIR, `${l.slug}.handoff.md`), renderHandoff(l));
}
export function load(root, slug) {
  const dir = path.join(root, DIR);
  if (!slug) {
    const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.items.json')) : [];
    if (!all.length) throw new Error('no ledgers yet');
    slug = all.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f.replace(/\.json$/, '');
  }
  return readJson(ledgerPath(root, slug));
}

export function cmdLedger(root, file) {
  const input = readJson(path.resolve(root, file));
  const base = path.basename(file);
  if (input && !input.slug && base.endsWith('.items.json')) input.slug = base.slice(0, -'.items.json'.length);
  const { errors, warnings } = validate(input);
  if (errors.length) return { errors, warnings };
  const l = buildLedger(input);
  save(root, l);
  return { errors, warnings, ledger: l };
}

export function cmdNote(root, slug, id, verdict, text) {
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be ${VERDICTS.join('|')}`);
  const l = load(root, slug);
  const it = l.items.find((i) => i.id === id);
  if (!it || it.class !== 'noise') throw new Error(`${id} is not a noise item in ${l.slug}`);
  it.note = { verdict, text: String(text || '').trim() };
  it.status = 'reviewed';
  save(root, l);
  return l;
}

export function cmdDone(root, slug, id) {
  const l = load(root, slug);
  const it = l.items.find((i) => i.id === id);
  if (!it || it.class !== 'signal') throw new Error(`${id} is not a signal item in ${l.slug}`);
  it.status = 'done';
  save(root, l);
  return l;
}

export function cmdAdd(root, slug, text, cls = 'noise', reason = 'caught mid-flight, off the critical path') {
  const l = load(root, slug);
  if (!['noise', 'cut'].includes(cls)) throw new Error('mid-flight additions can only be noise or cut');
  const n = l.items.filter((i) => i.class === cls).length + 1;
  l.items.push({ id: `${cls === 'noise' ? 'N' : 'C'}${n}`, text, class: cls, reason, effort: 1, status: cls === 'noise' ? 'queued' : 'cut', note: null });
  l.stats[cls] += 1;
  save(root, l);
  return l;
}

export function status(l) {
  const sig = l.items.filter((i) => i.class === 'signal');
  const noise = l.items.filter((i) => i.class === 'noise');
  const lines = [card(l)];
  const reviewed = noise.filter((i) => i.note);
  lines.push(`signal done ${sig.filter((i) => i.status === 'done').length}/${sig.length} | noise reviewed ${reviewed.length}/${noise.length}`);
  for (const i of reviewed) lines.push(`  ${i.id} ${i.note.verdict}: ${i.note.text}`);
  lines.push(`ledger: ${DIR}/${l.slug}.md`);
  return lines.join('\n');
}

// ---------- CLI ----------
const HELP = `signal-noise <command>
  ledger <items.json>                      validate + write ledger, handoff, print the signal card
  done <slug> <S-id>                       mark a signal item done
  add <slug> "<text>" [cut]                park something caught mid-flight as noise (or cut)
  note <slug> <N-id> <done|later|drop> "<text>"   record a quick-pass verdict
  status [slug]                            card + progress + quick-pass results (latest if no slug)`;

function main() {
  const [cmd, ...a] = process.argv.slice(2);
  const root = process.cwd();
  const say = (s) => process.stdout.write(s + '\n');
  switch (cmd) {
    case 'ledger': {
      if (!a[0]) throw new Error('usage: ledger <items.json>');
      const r = cmdLedger(root, a[0]);
      for (const w of r.warnings) say(`warn: ${w}`);
      if (r.errors.length) { for (const e of r.errors) say(`error: ${e}`); process.exitCode = 1; return; }
      say(card(r.ledger));
      break;
    }
    case 'done': say(card(cmdDone(root, a[0], a[1]))); break;
    case 'add': { const l = cmdAdd(root, a[0], a[1], a[2] || 'noise'); say(`parked as ${l.items.at(-1).id}`); break; }
    case 'note': { cmdNote(root, a[0], a[1], a[2], a.slice(3).join(' ')); say(`noted ${a[1]}`); break; }
    case 'status': say(status(load(root, a[0]))); break;
    default:
      say(HELP);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (e) { process.stderr.write(`signal-noise: ${e.message}\n`); process.exitCode = 1; }
}
