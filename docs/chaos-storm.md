# chaos-storm

## What it does

Chaos Storming measures codebase health by chance, not by choice. Once per repo it maps the landscape (apps, packages, tools, file types) and asks you what to include. Each run then picks random files from every included area (5 by default), and a cheap subagent per area answers four questions about each file:

1. What is the file trying to do?
2. How is it doing it?
3. What is it doing outside its core purpose?
4. Can it be reasoned with?

Each answer gets a one-line assessment and a score from 1 to 5. Weak files are escalated: they are re-reviewed alongside the files they import, one level deep. Files that are still weak become concerns with a concrete action.

The report grades every area A to E, then gives each file a four-row table (question, score, assessment), a line saying whether it was drilled into its imports and with what result, and its remedial action if it has one. It closes with a single table of remedial actions, worst first.

## When to reach for it

- On a schedule (weekly, or before a release) to watch the health of a fast-growing, agent-written codebase.
- After a burst of generated code, to see whether it is coherent or quietly sprawling.
- When joining or inheriting a codebase and you want an honest, unbiased first read.

## Common questions

**Why random?** Reviews of code you chose to look at are biased towards code you already worry about. Random sampling, repeated over runs, converges on the truth. Runs prefer files that have never been reviewed, so coverage grows over time. Pass `--seed` to replay a run exactly.

**How much does it cost?** The main agent never reads source files. Scripts do the scanning, sampling, import resolution, validation and scoring; review is done by the review tier (Sonnet or Sol at low effort), mapping by the fast tier. Live evals report the exact cost per run.

**Can I change what is sampled?** Edit `.chaos-storm/map.json`: included areas, extensions, excludes, sample size, `maxLines`, thresholds and model names. Delete it to redo the setup grilling.

**Which languages?** Sampling works for any text files. One-level import resolution understands JS/TS (relative, tsconfig paths, workspace packages) and Python; other languages fall back to quoted relative paths.

## It's working if

- The report names files you recognise as problems, and some you did not know about.
- Concerns come with actions you would actually take.
- Clean, boring files score well and are left alone.
- Area grades move over time as you fix what it finds.
