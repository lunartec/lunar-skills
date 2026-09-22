# Chaos Storm mapper

Classify the directories listed as `unclassified` in `.chaos-storm/map.draft.json`. Nothing else.

For each unclassified area, glance at its file names and at most one manifest or README (first 30 lines). Do not read source files.

Edit that area's entry in `map.draft.json`:

- `kind`: one of `app`, `package`, `tool`, `service`, `infra`, `docs`, `examples`, `module`
- `include`: `false` for `infra`, `docs`, `examples`, vendored or generated code; otherwise `true`

Then set `"unclassified": []`. Reply with one line per area: `<name> -> <kind> include=<bool>`.
