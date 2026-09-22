// Graders: turn a finished workspace + transcript into pass/fail assertions.
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

function globFiles(ws, pattern) {
  const parts = pattern.split('/');
  let cur = [ws];
  for (const part of parts) {
    const re = new RegExp('^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const next = [];
    for (const d of cur) {
      let entries = [];
      try { entries = fs.readdirSync(d); } catch { continue; }
      for (const e of entries) if (re.test(e)) next.push(path.join(d, e));
    }
    cur = next;
  }
  return cur;
}

function latestChaosReport(ws) {
  const files = globFiles(ws, '.chaos-storm/runs/*/report.json').sort();
  return files.length ? readJson(files.at(-1)) : null;
}

function snLedger(ws) {
  const dir = path.join(ws, '.signal-noise');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.items.json')); } catch { return null; }
  if (!files.length) return null;
  const newest = files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0].f;
  return readJson(path.join(dir, newest));
}

function daChallenge(ws) {
  const hits = globFiles(ws, '.devils-advocate/*/challenge.json');
  if (!hits.length) return null;
  const f = hits.map((h) => ({ h, t: fs.statSync(h).mtimeMs })).sort((a, b) => b.t - a.t)[0].h;
  const c = readJson(f);
  return c ? { ...c, challenges: c.challenges || [], __file: f } : null;
}

const fileEntry = (report, p) => report?.areas.flatMap((a) => a.files).find((f) => f.path === p);
const itemText = (i) => `${i.text} ${i.reason}`;

/**
 * @param {object} a assertion from the case file
 * @param {{ws:string, transcript:object, agent:string}} ctx
 * @returns {{pass:boolean|null, detail:string}} pass=null means not applicable for this agent
 */
export function check(a, ctx) {
  const { ws, transcript: t } = ctx;
  switch (a.type) {
    case 'file': {
      const hits = globFiles(ws, a.glob);
      return { pass: hits.length > 0, detail: hits.length ? `${hits.length} match` : `nothing at ${a.glob}` };
    }
    case 'chaos.areas': {
      const r = latestChaosReport(ws);
      const n = r?.areas.length || 0;
      return { pass: n >= a.min, detail: `${n} areas graded${r ? `: ${r.areas.map((x) => `${x.area} ${x.grade}`).join(', ')}` : ''}` };
    }
    case 'chaos.flagged':
    case 'chaos.notFlagged':
    case 'chaos.concern': {
      const f = fileEntry(latestChaosReport(ws), a.path);
      if (!f) return { pass: false, detail: `${a.path} not in report` };
      const flagged = f.status !== 'ok';
      const detail = `${f.status}, score ${f.score} [P${f.scores.purpose} A${f.scores.approach} F${f.scores.focus} R${f.scores.reasoning}]`;
      if (a.type === 'chaos.flagged') return { pass: flagged, detail };
      if (a.type === 'chaos.notFlagged') return { pass: !flagged, detail };
      return { pass: f.status === 'concern', detail };
    }
    case 'chaos.escalated': {
      const r = latestChaosReport(ws);
      const n = r ? r.areas.flatMap((x) => x.files).filter((f) => f.escalated).length : 0;
      return { pass: n > 0, detail: `${n} files escalated` };
    }
    case 'sn.ledger': {
      const l = snLedger(ws);
      return { pass: Boolean(l), detail: l ? `${l.slug}: ${l.stats.signal}S ${l.stats.noise}N ${l.stats.cut}C` : 'no ledger' };
    }
    case 'sn.signalCount': {
      const n = snLedger(ws)?.stats.signal ?? 0;
      return { pass: n >= a.min && n <= a.max, detail: `${n} signal` };
    }
    case 'sn.signal':
    case 'sn.notSignal': {
      const l = snLedger(ws);
      if (!l) return { pass: false, detail: 'no ledger' };
      const re = new RegExp(a.match, 'i');
      const sig = l.items.filter((i) => i.class === 'signal');
      const hit = sig.find((i) => re.test(i.text));
      if (a.type === 'sn.signal') return { pass: Boolean(hit), detail: hit ? `${hit.id} ${hit.text}` : `no signal item matches /${a.match}/` };
      const where = l.items.filter((i) => i.class !== 'signal' && re.test(itemText(i))).map((i) => i.id);
      return { pass: !hit, detail: hit ? `wrongly signal: ${hit.id} ${hit.text}` : `kept out of signal${where.length ? ` (${where.join(',')})` : ''}` };
    }
    case 'sn.handoff': {
      const l = snLedger(ws);
      const ok = l && fs.existsSync(path.join(ws, '.signal-noise', `${l.slug}.handoff.md`));
      return { pass: Boolean(ok), detail: ok ? 'handoff written' : 'no handoff' };
    }
    case 'sn.quickPass': {
      const l = snLedger(ws);
      const n = l ? l.items.filter((i) => i.note).length : 0;
      return { pass: n >= a.min, detail: `${n} noise items have quick-pass verdicts` };
    }
    case 'da.report':
    case 'da.verdict':
    case 'da.lens': {
      const c = daChallenge(ws);
      if (!c) return { pass: false, detail: 'no challenge.json' };
      if (a.type === 'da.report') {
        const ok = fs.existsSync(path.join(path.dirname(c.__file), 'report.md'));
        return { pass: ok && c.challenges.length <= 5, detail: `${ok ? 'report.md written' : 'no report.md'}, ${c.challenges.length} challenges, verdict ${c.verdict}` };
      }
      if (a.type === 'da.verdict') return { pass: a.oneOf.includes(c.verdict), detail: `verdict ${c.verdict}` };
      const hits = c.challenges.filter((x) => x.lens === a.lens);
      const re = a.evidence ? new RegExp(a.evidence, 'i') : null;
      const good = hits.find((x) => !re || re.test([...(x.evidence || []), x.claim].join(' ')));
      return { pass: Boolean(good), detail: good ? `${good.confidence}/${good.consequence}: ${good.claim}` : hits.length ? `lens present but evidence missed /${a.evidence}/` : `no ${a.lens} challenge (lenses: ${c.challenges.map((x) => x.lens).join(', ')})` };
    }
    case 'orchestratorDidNotRead': {
      if (!t.hasToolDetail) return { pass: null, detail: 'n/a for this agent' };
      const offenders = [];
      for (const c of t.mainToolCalls) {
        const target = c.name === 'Read' ? String(c.input?.file_path || '') : c.name === 'Bash' ? String(c.input?.command || '') : '';
        if (c.name === 'Bash' && /chaos-storm\.mjs/.test(target)) continue;
        for (const p of a.paths) if (target.endsWith(p) || (c.name === 'Bash' && target.includes(p))) offenders.push(`${c.name} ${p}`);
      }
      return { pass: offenders.length === 0, detail: offenders.length ? offenders.join('; ') : 'main agent read no sampled sources' };
    }
    case 'delegated': {
      if (!t.hasToolDetail) return { pass: null, detail: 'n/a for this agent' };
      const n = t.mainToolCalls.filter((c) => c.name === 'Agent' || c.name === 'Task').length;
      const models = Object.keys(t.metrics.byModel || {});
      return { pass: n > 0, detail: `${n} subagents; models used: ${models.join(', ') || 'unknown'}` };
    }
    case 'skillInvoked': {
      const viaTool = t.mainToolCalls.some((c) => c.name === 'Skill' && String(c.input?.skill || c.input?.command || '').includes(a.name));
      const viaRead = t.raw.includes(`${a.name}/SKILL.md`);
      return { pass: viaTool || viaRead, detail: viaTool ? 'Skill tool called' : viaRead ? 'SKILL.md read' : 'skill never loaded' };
    }
    case 'maxCostUSD': {
      const c = t.metrics.costUSD;
      if (c == null) return { pass: null, detail: 'cost not reported' };
      return { pass: c <= a.value, detail: `$${c.toFixed(3)} (limit $${a.value})` };
    }
    default:
      return { pass: false, detail: `unknown assertion type ${a.type}` };
  }
}

export function gradeCase(kase, ctx) {
  const assertions = kase.assert.map((a) => {
    let r;
    try { r = check(a, ctx); } catch (e) { r = { pass: false, detail: `grader error: ${e.message}` }; }
    return { name: describe(a), type: a.type, soft: Boolean(a.soft), ...r };
  });
  const hardFail = assertions.some((x) => x.pass === false && !x.soft);
  return { assertions, status: ctx.error ? 'error' : hardFail ? 'fail' : 'pass' };
}

export function describe(a) {
  switch (a.type) {
    case 'file': return `file exists: ${a.glob}`;
    case 'chaos.areas': return `at least ${a.min} areas graded`;
    case 'chaos.flagged': return `flags ${a.path}`;
    case 'chaos.notFlagged': return `does not flag ${a.path}`;
    case 'chaos.concern': return `${a.path} survives escalation as a concern`;
    case 'chaos.escalated': return 'escalation ran on flagged files';
    case 'sn.ledger': return 'ledger written';
    case 'sn.signalCount': return `signal count ${a.min}-${a.max}`;
    case 'sn.signal': return `signal includes /${a.match}/`;
    case 'sn.notSignal': return `signal excludes /${a.match}/`;
    case 'sn.handoff': return 'noise handoff written';
    case 'sn.quickPass': return `quick pass recorded ${a.min}+ verdicts`;
    case 'da.report': return 'challenge rendered to report.md (max 5)';
    case 'da.verdict': return `verdict is ${a.oneOf.join(' or ')}`;
    case 'da.lens': return `raises ${a.lens}${a.evidence ? ` citing /${a.evidence}/` : ''}`;
    case 'orchestratorDidNotRead': return 'orchestrator never read sampled sources';
    case 'delegated': return 'work delegated to subagents';
    case 'skillInvoked': return `skill "${a.name}" triggered`;
    case 'maxCostUSD': return `cost under $${a.value}`;
    default: return a.type;
  }
}
