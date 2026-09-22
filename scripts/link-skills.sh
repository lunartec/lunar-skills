#!/usr/bin/env bash
# Symlink every skill in this repo into the local harness skill dirs, so `git pull` keeps them current.
#   ~/.claude/skills  (Claude Code)    ~/.agents/skills  (Codex and other agents)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
for DEST in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
  mkdir -p "$DEST"
  for skill in "$REPO"/skills/*/*/; do
    [ -f "$skill/SKILL.md" ] || continue
    name="$(basename "$skill")"
    target="$DEST/$name"
    if [ -e "$target" ] && [ ! -L "$target" ]; then
      echo "skip $name: $target exists and is not a symlink" >&2
      continue
    fi
    ln -sfn "${skill%/}" "$target"
    echo "linked $name -> $target"
  done
done
