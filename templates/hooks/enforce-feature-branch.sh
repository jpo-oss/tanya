#!/usr/bin/env bash
# PreToolUse hook (matcher: Edit|Write|NotebookEdit): refuse file edits in a
# git repo that is on main or master, so work happens on a feature branch.
# Exit 2 blocks the tool call and shows stderr to the model; exit 0 allows.
set -u
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
# The file's own folder decides when it exists; an edit can target another repo.
[ -n "$path" ] && [ -d "$(dirname "$path")" ] && dir=$(dirname "$path")
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
branch=$(git -C "$dir" symbolic-ref --short -q HEAD 2>/dev/null) || exit 0
case "$branch" in
  main|master)
    echo "Blocked: $(git -C "$dir" rev-parse --show-toplevel) is on $branch. Create a feature branch first." >&2
    exit 2 ;;
esac
exit 0
