# guiding-hand

## What it does

Turns "I need to fix or change this" into a guide a human engineer can follow, without writing the code for them. The agent is the architect; you (or the developer you hand it to) are the editor.

1. **Frame.** Restates the task in one line and classifies it as a bug, feature or change. If the whole diff fits in one sentence, it says the sentence and stops.
2. **Recon.** A script searches the repo for the task's terms, then walks the import graph one hop each way (seeing through barrel files and tsconfig paths) and finds the nearest tests and the test and lint commands. A fast-tier scout reads the candidates and decides which files really matter and in what role.
3. **Grill.** Only when the goal is unclear, and only about decisions the code cannot answer. Questions come in numbered rounds of up to four, each with a recommended answer; a question that depends on another waits for the next round. For bugs it confirms the symptom, the reproduction and what "fixed" means. It plays the goal back before writing anything.
4. **Guide.** The agent writes `guide.json`; the script refuses it until every mapped path exists, every named symbol is in its file, nothing says "TBD" or "handle edge cases", and nothing is a full implementation. It then renders `.guiding-hand/<slug>/guide.md` and lists files that import something you will modify but are missing from the map.
5. **Check.** When you are done, `guiding-hand check` compares your changes with the map: planned files you have not touched, and changes nobody planned.

The guide has a fixed shape:

| Section | Holds |
|---|---|
| Goal | Now, when done, out of scope |
| Decisions | What was agreed during grilling, and what was defaulted |
| File map | Every file in work order: modify, create, test, check (may break) or reference (pattern to copy), with symbols, why and what to do |
| Approach | Up to 12 plain-language steps |
| Coding guidance | Repo-specific rules and the existing pattern to mirror |
| Watch out for | Callers, contracts, data, config, concurrency, rated high, med or low |
| Verify | Commands plus one end-to-end check |
| Open questions | Anything unresolved, with a recommendation |

## When to reach for it

- You want to make the change yourself and need the lay of the land first.
- You are handing a ticket to a developer who does not know this part of the codebase.
- You are mentoring, and want the engineer to write the code but not waste a day finding where it goes.
- Before estimating: the file map shows how big the change really is.

## Common questions

**Will it write the code?** No. Signatures and snippets of up to eight lines are allowed; the script rejects anything longer. If you later ask the agent to implement it, the guide becomes its plan.

**Why does it ask me questions?** Only for decisions (behaviour, scope, trade-offs). Facts such as "where is the formatter" or "who calls this" come from the code. Say "just go" and it takes its own recommendations, marked as defaults in the guide.

**How does it find the files?** Term search, then one hop of imports and importers, then tests by name. JS/TS (relative imports, tsconfig paths, workspace packages, barrels) and Python imports are resolved; other languages rely on the term search and the scout.

**What if the map misses something?** `render` lists files that import anything you will modify but are not in the map, and `check` flags changes outside the map once the work is done.

## It's working if

- The engineer starts in the right file on the first try.
- Nothing in the review surprises them: every caller that broke was in the map as `check`.
- `guiding-hand check` shows no unplanned changes, or only ones the engineer can explain.
