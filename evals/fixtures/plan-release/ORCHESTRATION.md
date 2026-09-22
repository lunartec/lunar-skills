# Orchestration: release lib v2.0.0 today

Main agent coordinates these subagents to publish v2.0.0 to npm before 18:00.

- agent-ci: fix the 3 failing CI tests on main (blocking release).
- agent-migrate: write the v1 -> v2 migration guide for the 2 breaking API changes.
- agent-version: bump versions, generate CHANGELOG from changesets, tag.
- agent-publish: run `npm publish` with provenance once CI is green.
- agent-blog: draft a launch blog post with benchmarks.
- agent-bench: benchmark v2 against 4 competitor libraries.
- agent-social: write a 10-post social media thread.
- agent-theme: redesign the docs site theme for the v2 brand.
- agent-triage: triage the 40 oldest open issues and label them.
- agent-types: audit every exported type for naming consistency.
- agent-deps: upgrade all dev dependencies to latest majors.
