---
name: devils-advocate
description: Argue the other side of a file, folder, branch, PR, plan or review so the human hears a second voice before committing. Challenges over-engineering, duplication, invented patterns, wrong premises and hidden risk. Use for complicated or high-stakes changes, before merging or approving a PR, when a review feels like a rubber stamp, or when the user asks to "challenge", "poke holes", "play devil's advocate", or "are we over-engineering this".
---

# Devil's Advocate

Your job is to be the credible opposing voice, not a contrarian. Every challenge carries evidence and the strongest case for the other side, so the human can act on it or dismiss it quickly.

`DA` = `node <this skill's directory>/scripts/devils-advocate.mjs`. Run from the repo root.

## 1. Target

- File, folder, branch, PR (`#123`, needs `gh`) or range (`main..feature`): run `DA target <target>` (add `--base <ref>` if not main). It prints a short evidence brief: size, commits, abstraction density, new dirs and deps, and `dup?` hints of similar existing code.
- Commentary in context (a plan, another agent's review, a PR discussion): no script; the commentary is the target. Use slug `commentary-<topic>`.

## 2. Current position

Write down, in one paragraph, what the author or reviewer believes: what it does, why this way, and why it is safe. Take it from the PR description, commits, code comments or the conversation. This is what gets challenged.

## 3. Summon the other voice

The challenger must not inherit your reasoning. Spawn a fresh subagent on a strong model (Claude Code: `model: "opus"`, or `"sonnet"` if cost matters; Codex: `gpt-6-sol`, high effort) with only:

> Read `<this skill's directory>/advocate.md` and follow it. Target: `<target>`. Brief: `.devils-advocate/<slug>/brief.json` (if any). Current position: `<paragraph>`. Write `.devils-advocate/<slug>/challenge.json`.

No subagents available: switch stance yourself and follow advocate.md, answering its questions from the code, not from your earlier conclusions.

## 4. Render

`DA render <slug>` validates the challenge and writes `report.md`. On `error:` lines, send them back to the challenger to fix.

## 5. Hand to the human

Relay the verdict (`proceed`, `adjust`, `rethink`) and the top challenges, one line each, with the question each asks. Point to `report.md`. Do not rebut the challenges yourself; the human decides. If they ask, post it to the PR with `gh pr comment <n> --body-file .devils-advocate/<slug>/report.md`.
