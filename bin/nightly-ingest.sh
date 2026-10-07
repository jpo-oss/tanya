#!/usr/bin/env bash
# Nightly vault intake: once a day at RUN_HOUR_UTC, process recordings waiting
# in _Incoming and triage every note in each vault's 00 Inbox, headless, on
# Sonnet. launchd calls this hourly; it works on the first call at or after
# the most recent RUN_HOUR_UTC (or when FORCE=1), so the schedule survives any
# local timezone change and a Mac asleep at that hour catches up on waking.
# The author runs it at 16 UTC, the author's local midnight: convert your own
# local midnight to UTC before you set the hour.
#
# Output: $ASSISTANT_HOME/state/nightly-ingest/<date>.log and a completion
# note the run itself writes to $ASSISTANT_HOME/inbox/<date>-nightly-ingest.md,
# which the assistant reads at its next session start and relays.
#
# Change for your setup (or export before calling):
#   ASSISTANT_HOME  the assistant's folder               (default ~/Tanya)
#   ASSISTANT_NAME  what the assistant is called          (default Tanya)
#   VAULTS          parent folder of the vaults and _Incoming (required)
#   VAULT_NAMES     vault folders under VAULTS whose inbox to triage, separated
#                   by colons, for example "Silo 1:Silo 2"  (required)
#   RUN_HOUR_UTC    two-digit UTC hour to act in          (default 00)
#   RUN_TIMEOUT_S   seconds before the run is killed      (default 14400)
#   and the review skills in the prompt below.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin"
TANYA="${ASSISTANT_HOME:-$HOME/Tanya}"
NAME="${ASSISTANT_NAME:-Tanya}"
VAULTS="${VAULTS:-}"
VAULT_NAMES="${VAULT_NAMES:-}"
RUN_HOUR_UTC="${RUN_HOUR_UTC:-00}"
RUN_TIMEOUT_S="${RUN_TIMEOUT_S:-14400}"
STATE="$TANYA/state/nightly-ingest"
mkdir -p "$STATE" "$TANYA/inbox"
today=$(date -u +%F)
# The UTC date of the most recent scheduled run: the date it was RUN_HOUR_UTC
# hours ago. last-run holds the slot already done.
due_epoch=$(( $(date -u +%s) - 10#$RUN_HOUR_UTC * 3600 ))
slot=$(date -u -r "$due_epoch" +%F 2>/dev/null || date -u -d "@$due_epoch" +%F)
last_run="$STATE/last-run"
if [ "${FORCE:-0}" != "1" ] && [ "$(cat "$last_run" 2>/dev/null)" = "$slot" ]; then exit 0; fi
log="$STATE/$today.log"
note="$TANYA/inbox/$today-nightly-ingest.md"
if [ -z "$VAULTS" ] || [ -z "$VAULT_NAMES" ]; then
  echo "$(date -u +%FT%TZ) ERROR VAULTS and VAULT_NAMES must be set (launchd plist EnvironmentVariables); nothing ran" | tee -a "$log" >&2
  printf '# Nightly ingest %s\n\nNothing ran: VAULTS and VAULT_NAMES are not set in the launchd job.\n' "$today" > "$note"
  exit 1
fi
# The lock holds the run's PID. A dead PID means a hard kill left it behind.
# A live one older than 6 hours (the run is killed after RUN_TIMEOUT_S) is
# hung: take over and say so in the completion note.
lock="$STATE/.lock"
stale=""
if ! mkdir "$lock" 2>/dev/null; then
  pid=$(cat "$lock/pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    if [ -z "$(find "$lock" -maxdepth 0 -mmin +360)" ]; then
      echo "$(date -u +%FT%TZ) already running (pid $pid)" >> "$log"
      exit 0
    fi
    stale="A previous nightly run (pid $pid) held the lock for over 6 hours and was taken over; check it with ps."
    echo "$(date -u +%FT%TZ) WARN $stale" | tee -a "$log" >&2
  else
    echo "$(date -u +%FT%TZ) removing stale lock (pid ${pid:-unknown} not running)" >> "$log"
  fi
  rm -rf "$lock"
  mkdir "$lock" || exit 1
fi
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT
echo "$(date -u +%FT%TZ) start" >> "$log"
steps="" n=2
IFS=: read -r -a vault_list <<< "$VAULT_NAMES"
for v in "${vault_list[@]}"; do
  steps="$steps
$n. $v inbox: run the vault-review skill on \"$VAULTS/$v\" and triage every note in its 00 Inbox except \"About the Inbox.md\"."
  n=$((n + 1))
done
read -r -d '' PROMPT <<EOP
You are $NAME running unattended at $RUN_HOUR_UTC:00 UTC on $today. Do the vault intake and nothing else.

1. Recordings: if any audio or video files sit under $VAULTS/_Incoming or its subfolders, or any Markdown files sit under $VAULTS/_Incoming/fellow or $VAULTS/_Incoming/fieldy (poller transcripts, already transcribed), run the ingest-recordings skill on them. If none, say so and move on.$steps

Rules for an unattended run: nobody can answer a question. Where a step needs the owner's decision, leave the item where it is and list it with the question. Commit each vault's changes on its current branch per that vault's CLAUDE.md using structured-git-commits; do not push. Never delete source files in _Incoming; the skills move them.

Finally write $note with: what was processed, what was filed where (vault, folder, note), what was left in place and why, and any errors. Keep it under 60 lines. Plain sentences, no dashes.
EOP
cd "$TANYA" || exit 1
claude -p "$PROMPT" --model sonnet --permission-mode auto --add-dir "$VAULTS" --output-format json >> "$log" 2>&1 &
cpid=$!
# No coreutils timeout on a stock Mac: a background sleep kills the run instead.
( sleep "$RUN_TIMEOUT_S" && kill "$cpid" && echo "$(date -u +%FT%TZ) killed after ${RUN_TIMEOUT_S}s" >> "$log" ) 2>/dev/null &
wpid=$!
wait "$cpid"
rc=$?
pkill -P "$wpid" sleep 2>/dev/null
echo "$(date -u +%FT%TZ) end rc=$rc" >> "$log"
# Any finished attempt counts, so a failing run does not retry every hour.
echo "$slot" > "$last_run"
[ -f "$note" ] || printf '# Nightly ingest %s\n\nThe run ended with exit code %s and wrote no completion note. See %s.\n' "$today" "$rc" "$log" > "$note"
[ -z "$stale" ] || printf '\n%s\n' "$stale" >> "$note"
exit $rc
