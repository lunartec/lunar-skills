# lunar-skills

Lean, script-backed agent skills for real engineering work. They run in **Claude Code** and **Codex** and are designed around three ideas:

1. **Lean prompts.** Every `SKILL.md` has a token budget, and CI checks it. The orchestrating agent carries only what it needs.
2. **Scripts do the heavy lifting.** Anything deterministic (scanning a repo, random sampling, resolving imports, validating output, scoring, rendering reports) is a zero-dependency Node script, not tokens.
3. **The right model for the job.** Cheap, fast models do the bulk work; strong models are reserved for judgement; the main agent orchestrates and never reads what a subagent can summarise.

By [Gareth Parker](https://github.com/lunartec), CTO and software engineer (16 years in aerospace and defence, now construction tech). The structure follows [mattpocock/skills](https://github.com/mattpocock/skills).

## Install

Pick **one** route. Installing both gives you every skill twice.

### Claude Code: the plugin

```
/plugin marketplace add lunartec/lunar-skills
/plugin install lunar-skills@lunartec
```

### Codex, Claude Code and other agents: skills.sh

```bash
npx skills@latest add lunartec/lunar-skills
```

Choose the skills and agents you want. Files are copied into your project, so you own and can edit them. One skill at a time:

```bash
npx skills@latest add lunartec/lunar-skills --skill=chaos-storm
```

### From a clone (to hack on the skills)

```bash
git clone https://github.com/lunartec/lunar-skills && cd lunar-skills
npm run link   # symlinks every skill into ~/.claude/skills and ~/.agents/skills
```

Requirements: Node 18+ and git. `gh` only for PR targets in devils-advocate.

## Skills

### User-invoked

- **[chaos-storm](./skills/engineering/chaos-storm/SKILL.md)**: Chaos Storming codebase health check. Randomly samples files from every app, package and tool area, asks four questions of each, and escalates weak files through their imports. Run `/chaos-storm` (Claude Code) or `$chaos-storm` (Codex).

### Model-invoked (the agent can reach for them, and so can you)

- **[signal-noise](./skills/productivity/signal-noise/SKILL.md)**: cuts a plan, orchestration, diff or draft to the 3 to 5 things that make real progress now, and hands the rest to a cheap subagent for a quick pass you review later.
- **[devils-advocate](./skills/engineering/devils-advocate/SKILL.md)**: argues the other side of a file, folder, branch, PR, plan or review. Challenges over-engineering, duplication, invented patterns, wrong premises and hidden risk, with evidence and a steelman for every point.

Human-facing docs: [docs/](./docs).

## chaos-storm

**Chaos Storming** is a concept of mine: combine chaos theory's indiscriminate sampling with brainstorming's lack of prejudice to measure the real health of a codebase. Codebases grow fast now that agents write the code; reviewing what you chose to review tells you little. Reviewing what chance hands you tells you the truth.

```
map (once) ─▶ grill: which areas, extensions, sample size ─▶ .chaos-storm/map.json
select ─▶ 5 random files per area (seeded, prefers files never reviewed)
review ─▶ one cheap subagent per area answers the four questions, writes JSON
escalate ─▶ weak files are re-reviewed with their direct imports (one level)
report ─▶ per file: a four-question table (score + assessment), import drill-downs, remedial actions
```

The four questions for every file:

| Question | Score |
|---|---|
| What is the file trying to do? | `purpose` |
| How is it doing it? | `approach` (simplest, leanest way?) |
| What is it doing outside its core purpose? | `focus` |
| Can it be reasoned with? | `reasoning` (understandable in isolation, self-contained) |

A file is flagged when its mean drops below 3 or any score is 2 or lower. Flagged files get a second look with the files they import; many turn out to be sensible coordinators. What stays bad becomes a **concern** with a concrete action.

The report (`.chaos-storm/runs/<id>/report.md`) is deliberately lean. For every file:

```
### `apps/web/src/router.ts` · 1.75 · CONCERN

| Question | Score | Assessment |
|---|:-:|---|
| What is it trying to do? | 2 | Routes, tracks and flags. |
| How is it doing it? | 2 | If-chain. |
| What is it doing outside its purpose? | 1 | Analytics, flags, logging. |
| Can it be reasoned with? | 2 | Random flags make it unpredictable. |

Drilled into imports: `apps/web/src/checkout.ts` → still a concern (2.25 → 1.75)

**Action:** Move analytics and flags out of the router.
```

It ends with a **Remedial actions** table, worst file first.

## signal-noise

Steve Jobs' signal-to-noise rule applied to agent work. **Signal**: the 3 to 5 non-negotiables for the horizon (default: this session). **Noise**: everything else. The main agent spends at least 80% of its effort on signal; noise gets at most 20%, spent by a cheaper model, and lands in a ledger (`.signal-noise/<slug>.md`) with a quick-pass verdict per item (`done`, `later`, `drop`) for you to review later. The script enforces the rules: no more than five signals, a reason for everything, and a warning when the classification is too generous.

## devils-advocate

A deliberately opposing voice for complicated or high-stakes changes and for PR review. A script builds an evidence brief (diff size, abstraction density, new dirs and dependencies, similar code that already exists); a **fresh** subagent that has not seen the main agent's reasoning then argues the other side through six lenses: over-engineering, duplication, new pattern, premise, risk, review gap. Every challenge needs evidence, the strongest case for the current approach, a question for the human and an alternative action. Output is a verdict (`proceed`, `adjust`, `rethink`) and a report you can post to the PR with `gh pr comment`.

## Models

Skills name a tier, not a vendor. Override per repo where the skill has config (`chaos-storm` reads `models` from `.chaos-storm/map.json`).

| Tier | Used for | Claude Code | Codex |
|---|---|---|---|
| fast | mapping, noise quick pass | `haiku` | `gpt-6-luna` |
| review | chaos-storm file reviews | `sonnet` | `gpt-6-sol`, low effort |
| strong | devils-advocate challenger | `opus` (or `sonnet`) | `gpt-6-sol`, high effort |

No subagents available? Every skill has a fallback that keeps the same output contract.

## Testing and refining the skills

```bash
npm test              # deterministic tests: scripts, schemas, repo conventions (free, fast)
npm run budget        # token estimate for every SKILL.md and subagent prompt
npm run eval          # tests + budgets -> reports/test-report.html
npm run eval:live     # + live evals: real claude / codex runs on fixture repos, graded
npm run eval:live -- --agent claude --case sn-login --repeat 3 --keep
npm run report        # re-render the HTML from the last saved results (free)
```

The HTML report shows pass/fail per test and per assertion, prompt budgets, and for live runs the cost, time, turns, tokens by model, **delegated share** (tokens spent inside subagents rather than the orchestrator) and **fast-tier share** (tokens processed by the cheapest model class). A history section tracks pass rate, cost and prompt size across runs, so you can see whether an edit to a `SKILL.md` made it better, cheaper or leaner.

A sample from a real run is committed at [docs/sample-test-report.html](./docs/sample-test-report.html) (download and open it; GitHub shows HTML as source).

Live cases live in `evals/cases/<skill>/*.json`: a fixture (`evals/fixtures/`), optional setup commands and feature-branch overlays, a prompt per agent, and assertions graded against what the agent leaves on disk and in its transcript (for example "flags `mega.ts`", "signal excludes /competitor/", "orchestrator never read sampled sources", "raises duplication citing money.ts"). Assertions marked `soft` warn without failing.

## Repo layout

```
skills/<bucket>/<skill>/   SKILL.md, subagent prompts, scripts/, agents/openai.yaml (Codex metadata)
docs/                      human-facing page per skill
tests/                     node:test suites (zero dependencies)
evals/                     live eval runner, graders, cases, fixtures, HTML report
scripts/                   budget checker, link-skills.sh
.claude-plugin/            plugin + single-plugin marketplace manifests
```

## License

MIT
