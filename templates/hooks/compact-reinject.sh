#!/usr/bin/env bash
# SessionStart hook (matcher: compact|resume) for the assistant only. After a
# compaction or resume, re-inject the facts that live only in the running
# conversation: the day log the assistant keeps, the last inbox actions, and a
# reminder of what to re-read. CLAUDE.md and memory come back on their own.
set -u
# ASSISTANT_HOME: the assistant's folder. ASSISTANT_NAME: what it is called.
T="${ASSISTANT_HOME:-$HOME/Tanya}"
name="${ASSISTANT_NAME:-Tanya}"
# Only for the assistant's own sessions: started in its folder, or the
# home-dir session the owner resumes with <name>-resume. Project sessions get
# nothing from this.
cwd=$(jq -r '.cwd // empty' 2>/dev/null)
case "$cwd" in "$T"|"$T"/*|"$HOME") ;; *) exit 0 ;; esac
log="$T/state/day-log.md"
actions="$T/state/inbox-actions.jsonl"
{
  echo "Post-compaction context for ${name} (generated $(date -u +%FT%TZ))."
  echo "You are ${name}, mid-day, after a compaction. Re-read registry.json only if a routing question comes up. Open threads, rulings and pending decisions from today follow; treat them as current."
  if [ -s "$log" ]; then echo; echo "## Day log (state/day-log.md)"; tail -n 60 "$log"; else echo; echo "## Day log: empty"; fi
  if [ -s "$actions" ]; then echo; echo "## Last inbox actions"; tail -n 8 "$actions"; fi
  echo; echo "Keep appending to state/day-log.md as rulings and threads arrive; it is what survives the next compaction."
} | jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}'
exit 0
