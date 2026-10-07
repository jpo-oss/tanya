#!/usr/bin/env bash
# Status line: model, context used, git branch. Claude Code pipes session
# JSON on stdin and shows the first line printed.
input="$(cat)"
model=$(printf '%s' "$input" | jq -r '.model.display_name // "?"')
pct=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty' | cut -d. -f1)
dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty')
branch=$(git -C "${dir:-.}" symbolic-ref --short -q HEAD 2>/dev/null)
line="[$model]"
[ -n "$pct" ] && line="$line ${pct}% context"
[ -n "$branch" ] && line="$line | $branch"
echo "$line"
