# Working on lunar-skills

Skills live in bucket folders under `skills/`:

- `engineering/`: code work (chaos-storm, devils-advocate)
- `productivity/`: workflow tools (signal-noise)

Every skill folder has `SKILL.md`, `agents/openai.yaml` (Codex metadata), and, where it needs one, `scripts/<skill-name>.mjs` plus prompts it hands to subagents (`reviewer.md`, `advocate.md`, ...).

Rules, all checked by `npm test` (`tests/repo.test.mjs`):

- Every skill is listed in `.claude-plugin/plugin.json`, linked from the top-level `README.md` and its bucket `README.md`, and has a page at `docs/<skill>.md`.
- `name` in frontmatter matches the folder name.
- **Invocation**: user-invoked skills set `disable-model-invocation: true` in `SKILL.md` and `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Keep the two in sync. User-invoked descriptions are one human-facing line; model-invoked descriptions carry trigger phrases.
- **Budgets**: `SKILL.md` stays under 1200 estimated tokens, subagent prompts under 800 (`npm run budget`). If a skill needs more, move it into a script or a subagent prompt.
- **Scripts**: zero dependencies, Node 18+, one file per skill, exports its functions for tests, prints compact output (the orchestrator reads every byte).
- **Models**: name tiers (fast, review, strong) and give both the Claude Code and Codex model; always give a no-subagent fallback.
- Refer to the skill's own files as `<this skill's directory>/...`; both harnesses tell the agent where the skill lives.

When you change a skill's behaviour: update its docs page, add or adjust a test, and if it changes what the agent does, add or adjust a live case in `evals/cases/<skill>/`. Run `npm run eval` and check `reports/test-report.html`.
