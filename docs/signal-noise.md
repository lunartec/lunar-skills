# signal-noise

## What it does

Applies Steve Jobs' signal-to-noise rule to an agent's workload. It lists every item in the plan, orchestration, diff or draft in context and applies one test to each: *if this is not done by the end of the horizon, does the goal fail?* The 3 to 5 items that pass are the signal and become the agent's whole plan. The rest is noise (worth a quick look later) or cut (not worth anyone's tokens). Noise is handed to a cheap subagent for a quick pass, and each item gets a verdict (`done`, `later`, `drop`) in a ledger you review when the real work has landed.

## When to reach for it

- A plan has grown to 15 steps and the goal is one of them.
- Before kicking off a multi-agent orchestration: which subagents does the goal actually need?
- A diff has picked up refactors and polish that are not part of the change.
- A draft says too much.

## Common questions

**Why at most five?** Because more than five is not a priority list. The script rejects six and tells the agent to rank by goal impact times unblocking.

**Is noise thrown away?** No. It is parked with a reason and a quick-pass verdict so nothing is lost; it just does not consume the main agent's attention now.

**What is the horizon?** Jobs used the next 18 waking hours. The default here is the current session; say "by Friday" and the test changes accordingly.

## It's working if

- The agent finishes the thing that mattered instead of half of everything.
- The ledger has a handful of `later` items you are glad were not done today, and a few `drop`s you are glad were never done.
