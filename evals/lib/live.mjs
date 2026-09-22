// Live evals: run a real agent CLI (claude / codex) against a fixture with the skill installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { gradeCase } from './grade.mjs';

export const AGENTS = {
  claude: {
    bin: 'claude',
    skillDir: '.claude/skills',
    args: (prompt, opts) => [
      '-p', prompt,
      '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Bash Read Write Edit Glob Grep Agent Task Skill TodoWrite',
      ...(opts.model ? ['--model', opts.model] : []),
    ],
  },
  codex: {
    bin: 'codex',
    skillDir: '.agents/skills',
    args: (prompt, opts) => [
      'exec', '--json', '--full-auto', '--skip-git-repo-check',
      ...(opts.model ? ['-m', opts.model] : []),
      prompt,
    ],
  },
};

export function available(agent) {
  try { execFileSync(AGENTS[agent].bin, ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}
export function version(agent) {
  try { return execFileSync(AGENTS[agent].bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

export function findSkill(root, name) {
  for (const bucket of fs.readdirSync(path.join(root, 'skills'))) {
    const d = path.join(root, 'skills', bucket, name);
    if (fs.existsSync(path.join(d, 'SKILL.md'))) return d;
  }
  throw new Error(`skill ${name} not found`);
}

export function prepareWorkspace(root, kase, agent) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `lunar-eval-${kase.id}-`));
  fs.cpSync(path.join(root, 'evals/fixtures', kase.fixture), ws, { recursive: true });
  const skillSrc = findSkill(root, kase.skill);
  const installed = path.join(ws, AGENTS[agent].skillDir, kase.skill);
  fs.cpSync(skillSrc, installed, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: ws, stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  const commit = (msg) => git('-c', 'user.name=eval', '-c', 'user.email=eval@example.com', 'commit', '-qm', msg);
  git('checkout', '-qb', 'main');
  commit('fixture');
  // Optional feature branch: overlay files on top of the fixture and commit them on a branch.
  if (kase.branch) {
    git('checkout', '-qb', kase.branch.name);
    fs.cpSync(path.join(root, 'evals/fixtures/overlays', kase.branch.overlay), ws, { recursive: true });
    git('add', '-A');
    commit(kase.branch.message || `Add ${kase.branch.overlay}`);
  }
  for (const [tool, ...args] of kase.setup || []) {
    const script = path.join(installed, 'scripts', `${tool}.mjs`);
    execFileSync('node', [script, ...args], { cwd: ws, stdio: 'pipe' });
  }
  return ws;
}

/** Parse a CLI transcript into tool calls + usage metrics, whatever the agent. */
export function parseTranscript(agent, raw) {
  const t = { raw, mainToolCalls: [], subToolCalls: 0, hasToolDetail: agent === 'claude', metrics: { byModel: {} }, finalText: '' };
  const seenMsg = new Set();
  let mainTok = 0;
  let subTok = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (agent === 'claude') {
      const mu = ev.type === 'assistant' && ev.message?.usage;
      if (mu && !seenMsg.has(ev.message.id)) {
        seenMsg.add(ev.message.id);
        const n = (mu.input_tokens || 0) + (mu.cache_read_input_tokens || 0) + (mu.cache_creation_input_tokens || 0) + (mu.output_tokens || 0);
        if (ev.parent_tool_use_id) subTok += n; else mainTok += n;
      }
      if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
        for (const c of ev.message.content) {
          if (c.type !== 'tool_use') continue;
          if (ev.parent_tool_use_id) t.subToolCalls++;
          else t.mainToolCalls.push({ name: c.name, input: c.input });
        }
      }
      if (ev.type === 'result') {
        t.finalText = ev.result || '';
        Object.assign(t.metrics, {
          costUSD: ev.total_cost_usd ?? null,
          durationMs: ev.duration_ms ?? null,
          turns: ev.num_turns ?? null,
          isError: Boolean(ev.is_error),
        });
        for (const [model, u] of Object.entries(ev.modelUsage || {})) {
          t.metrics.byModel[model] = {
            input: (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0),
            output: u.outputTokens || 0,
            costUSD: u.costUSD || 0,
          };
        }
      }
    } else {
      const u = ev.usage || ev.msg?.usage || ev.info?.total_token_usage;
      if (u && ev.type === 'turn.completed') {
        const m = (t.metrics.byModel.codex ||= { input: 0, output: 0, costUSD: null });
        m.input += (u.input_tokens || 0);
        m.output += (u.output_tokens || 0);
      }
      const item = ev.item || {};
      if (ev.type === 'item.completed' && item.type === 'command_execution') t.mainToolCalls.push({ name: 'Bash', input: { command: item.command } });
      if (ev.type === 'item.completed' && item.type === 'agent_message') t.finalText = item.text || t.finalText;
    }
  }
  const models = Object.values(t.metrics.byModel);
  t.metrics.inputTokens = models.reduce((a, m) => a + m.input, 0);
  t.metrics.outputTokens = models.reduce((a, m) => a + m.output, 0);
  // Share of all tokens spent inside subagents rather than the orchestrator (Claude transcripts only).
  t.metrics.delegatedShare = mainTok + subTok ? subTok / (mainTok + subTok) : null;
  return t;
}

function runCli(agent, ws, prompt, opts, timeoutSec) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(AGENTS[agent].bin, AGENTS[agent].args(prompt, opts), { cwd: ws, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); err += `\n[eval] timed out after ${timeoutSec}s`; }, timeoutSec * 1000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, wallMs: Date.now() - start }); });
  });
}

export async function runLiveCase(root, kase, agent, opts = {}) {
  const ws = prepareWorkspace(root, kase, agent);
  const prompt = typeof kase.prompt === 'string' ? kase.prompt : kase.prompt[agent];
  const res = await runCli(agent, ws, prompt, opts, kase.timeoutSec || 600);
  const transcript = parseTranscript(agent, res.out);
  if (transcript.metrics.durationMs == null) transcript.metrics.durationMs = res.wallMs;
  const error = res.code !== 0 ? `exit ${res.code}: ${res.err.trim().split('\n').slice(-3).join(' ')}` : null;
  const graded = gradeCase(kase, { ws, transcript, agent, error });
  if (opts.transcriptDir) {
    fs.mkdirSync(opts.transcriptDir, { recursive: true });
    fs.writeFileSync(path.join(opts.transcriptDir, `${kase.id}.${agent}.${opts.repeatIndex || 0}.jsonl`), res.out);
  }
  if (!opts.keep) fs.rmSync(ws, { recursive: true, force: true });
  return {
    case: kase.id, skill: kase.skill, description: kase.description, agent, repeat: opts.repeatIndex || 0,
    status: graded.status, error, assertions: graded.assertions,
    metrics: { ...transcript.metrics, mainToolCalls: transcript.mainToolCalls.length, subToolCalls: transcript.subToolCalls },
    finalText: transcript.finalText.slice(0, 800),
    workspace: opts.keep ? ws : null,
  };
}
