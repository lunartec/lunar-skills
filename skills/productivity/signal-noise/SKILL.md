---
name: signal-noise
description: Cut a plan, orchestration, diff or draft down to the 3-5 things that make real progress now, and hand the rest to a cheap subagent for a quick pass reviewed later. Use when a plan or task list sprawls, effort is spreading thin, before a large multi-step or multi-agent run, or when the user says "focus", "what actually matters", "trim this", or "signal vs noise".
---

# Signal / Noise

Steve Jobs' rule, applied to agent work. **Signal**: the 3 to 5 non-negotiables that must be done within the horizon (default: this session). **Noise**: everything else. The main agent spends at least 80% of its effort on signal. Noise gets at most 20%, and a cheaper model spends it.

`SN` = `node <this skill's directory>/scripts/signal-noise.mjs`. Run from the repo root.

## 1. Goal

State the outcome this horizon must produce in one sentence. If you cannot, ask the user one question.

## 2. Atomise

List every item in the work in context, one line each, 16 words or fewer: plan steps, subtasks, subagents in an orchestration, hunks or files in a diff, sections of a draft.

## 3. Classify

One test per item: **if this is not done by the end of the horizon, does the goal fail?**

- `signal`: yes. On the critical path, unblocks other items, is irreversible, or is the one check that proves the goal works.
- `noise`: no, but worth a quick look later. Polish, docs, adjacent refactors, extra tests beyond the core seam, research, comparisons, off-path hardening, reporting.
- `cut`: no, and not worth anyone's tokens. Speculative generality, duplicates, gold-plating.

Aim for 3 signal, never more than 5. If more pass, rank by goal impact times unblocking and demote the rest to noise. Give each item `effort` 1 to 5.

By mode: in a **diff**, hunks the behaviour change does not need are noise. In **prose**, sentences that do not move the reader to the point are noise. In an **orchestration**, a subagent whose output no signal step consumes is noise.

## 4. Record

Write `.signal-noise/<slug>.items.json`:

```json
{ "goal": "...", "horizon": "this session", "mode": "plan|orchestration|diff|prose",
  "items": [{ "text": "...", "class": "signal|noise|cut", "reason": "<=25 words", "effort": 2 }] }
```

Run `SN ledger .signal-noise/<slug>.items.json`. Fix any `error:` lines and rerun. It prints the **signal card**.

## 5. Hand off noise

If there is noise, spawn one subagent on the cheapest model (Claude Code: `model: "haiku"`; Codex: `gpt-6-luna`, low effort) in the background with:

> Read `.signal-noise/<slug>.handoff.md` and follow it. The script is `<this skill's directory>/scripts/signal-noise.mjs`.

Do not wait for it or read its output while signal work remains. No subagents available: skip this step; the ledger keeps the noise queued for later.

## 6. Execute signal

The signal card is now your plan; drop the old one from focus. Work signal items in order and run `SN done <slug> <id>` as each lands. If you catch yourself on something off the card, stop and park it: `SN add <slug> "<text>"`.

## 7. Close

Run `SN status <slug>` and tell the user: which signals landed, and how many noise items have quick-pass verdicts waiting in `.signal-noise/<slug>.md`.
