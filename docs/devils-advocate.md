# devils-advocate

## What it does

Gives you a second, deliberately opposing voice before you commit to something expensive or hard to reverse. Point it at a file, folder, branch, PR, range, plan or review. A script builds an evidence brief (size, abstraction density, new folders and dependencies, similar code that already exists). A fresh subagent that has not seen the main agent's reasoning then argues the other side through six lenses:

| Lens | Asks |
|---|---|
| overengineering | Is there a simpler design that meets today's need? |
| duplication | Does this already exist in the codebase, platform or a dependency? |
| new-pattern | Does it invent a pattern where an established one exists? |
| premise | Is the problem real and framed correctly? |
| risk | If this is wrong, what breaks and how hard is it to undo? |
| review-gap | What did the review skip or accept on trust? |

Every challenge carries evidence, the strongest case for the current approach, a question for you and an alternative action. You get a verdict (`proceed`, `adjust`, `rethink`) and a report you can post as a PR comment.

## When to reach for it

- The change is complicated, or important, and being wrong is expensive.
- A PR was approved quickly and you are not sure anyone pushed back.
- An agent built something clever and you suspect it is more clever than necessary.
- Before a migration, a new abstraction layer, or a new dependency.

## Common questions

**Is it just negative?** No. A challenge whose steelman wins is dropped, and `proceed` is a valid verdict. The point is that the other side was argued properly.

**Why a fresh subagent?** A model reviewing its own reasoning tends to agree with itself. The challenger gets the brief and the stated position, not the conversation.

**Can it review another agent's review?** Yes: point it at the review text (commentary in context). The `review-gap` lens exists for that.

## It's working if

- At least one challenge makes you pause, check something, or change the plan.
- You can dismiss the rest in seconds because the evidence and steelman are right there.
