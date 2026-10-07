#!/usr/bin/env bash
# UserPromptSubmit hook: when the context window is past a threshold, tell the
# model to ask the owner to /clear before starting new scope (ticket, branch, PR),
# or to /compact with a focus line before continuing current work.
#
# Reads the session transcript named in the hook input and takes the token
# usage of the last assistant turn (input + cache reads + cache writes), which
# is what the next turn will resend. Independent of any status line script.
#
# Threshold: CONTEXT_NUDGE_PCT (default 40). Exit 0 always; never blocks.
# OWNER_NAME: who runs /clear (default: you). RULE_SOURCE: where the rule lives,
# quoted in the nudge when set. CONTEXT_WINDOW: window size in tokens (default
# 200000); a model id with [1m], or usage already past it, means 1000000.
set -u
owner="${OWNER_NAME:-you}"
rule_source="${RULE_SOURCE:+ Rule source: ${RULE_SOURCE}.}"
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

last=$(grep '"type":"assistant"' "$transcript" | tail -1)
[ -n "$last" ] || exit 0
read -r used model < <(printf '%s' "$last" | jq -r '
  (.message.usage // {}) as $u
  | (($u.input_tokens // 0) + ($u.cache_read_input_tokens // 0) + ($u.cache_creation_input_tokens // 0)) as $used
  | "\($used) \(.message.model // "")"')
[ "${used:-0}" -gt 0 ] 2>/dev/null || exit 0

window="${CONTEXT_WINDOW:-200000}"
case "$model" in *'[1m]'*) window=1000000 ;; esac
[ "$used" -gt "$window" ] && window=1000000
pct=$(( used * 100 / window ))
threshold="${CONTEXT_NUDGE_PCT:-40}"
[ "$pct" -ge "$threshold" ] || exit 0

msg="Context window is at ${pct}% (${used} tokens). Before doing anything else, judge this prompt: if it starts new scope (a new ticket, branch, PR, project, or an unrelated task), reply only with a recommendation that ${owner} run /clear first and wait for the answer; do not start the work. If it continues the current work, recommend /compact with a one-line focus before any heavy step, then proceed.${rule_source}"
jq -cn --arg m "$msg" --arg s "Context at ${pct}%: /clear before new scope, /compact before heavy steps." \
  '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m},systemMessage:$s}'
exit 0
