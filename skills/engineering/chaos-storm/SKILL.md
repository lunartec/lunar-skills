---
name: chaos-storm
description: Chaos Storming codebase health check. Randomly samples files per app, package and tool area, asks four questions of each, and escalates weak files through their imports.
disable-model-invocation: true
---

# Chaos Storm

Random, indiscriminate sampling beats curated review for measuring real codebase health. You orchestrate; scripts and cheap subagents do the work. Never read sampled source files yourself.

`CS` = `node <this skill's directory>/scripts/chaos-storm.mjs`. Run it from the repo root.

## 1. Landscape (once per repo)

Run `CS map`.

- `map exists`: skip to step 2.
- Otherwise it prints a draft. If it lists `unclassified` dirs, spawn one subagent on the **map** model (see Models) with [mapper.md](mapper.md) to classify them. Do not read the tree yourself.

Grill the user briefly, one short round (use your ask-question tool if you have one):

1. Which areas to include (default: all apps, packages, tools; skip infra, docs, examples).
2. Which extensions (default: the dominant code extensions).
3. Files per area (default 5).

Then `CS configure --include "<globs or names>" --ext "<.ts,.tsx>" --sample <n>`. This writes `.chaos-storm/map.json`; suggest committing it.

## 2. Select

`CS select` (add `--seed <s>` to replay a run). It prints the run id and, per area, `slug` plus `path:lines` (`!` means over `maxLines`).

## 3. Review

For each area, spawn one subagent on the **review** model. Run areas in parallel. Prompt:

> Read `<skill dir>/reviewer.md` and follow it. Run `<run id>`, area slug `<slug>`, maxLines `<n>`. Files: `<paths>`. Write `.chaos-storm/runs/<run id>/reviews/<slug>.json`.

Each replies with one line. Then `CS validate`; send any errors back to that subagent to fix.

## 4. Escalate

`CS escalate` lists flagged files with their direct local imports. For each area with flagged files, spawn one **review** subagent:

> Read `<skill dir>/reviewer.md`, section Escalation. Run `<id>`, slug `<slug>`. Flagged files and deps: `<lines from escalate>`. Write `.chaos-storm/runs/<id>/reviews/<slug>.escalated.json`.

Validate again.

## 5. Report

`CS report` writes `report.md` and `report.json` in the run folder. Relay its summary lines to the user: overall grade, grade per area, and each concern with its action. Point to `report.md` for detail. Do not paste the full report.

## Models

Use the cheapest model that fits each role. `map.json` `models` holds the names:

- Claude Code: subagent tool with `model: "haiku"` (map) and `model: "sonnet"` (review).
- Codex: spawn subagents with the configured models (defaults `gpt-6-luna` for map, `gpt-6-sol` at low effort for review).
- No subagents available: do the step yourself, keeping reviewer.md's output contract.
