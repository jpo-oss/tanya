#!/usr/bin/env bash
# Nightly vault intake: once a day at RUN_HOUR_UTC, process recordings waiting
# in _Incoming and triage every note in each vault's 00 Inbox, headless, on
# Sonnet. launchd calls this hourly; it only works when the UTC hour matches
# RUN_HOUR_UTC (or when FORCE=1), so the schedule survives any local timezone
# change. The author runs it at 16 UTC, the author's local midnight:
# convert your own local midnight to UTC before you set the hour.
#
# Output: $ASSISTANT_HOME/state/nightly-ingest/<date>.log and a completion
# note the run itself writes to $ASSISTANT_HOME/inbox/<date>-nightly-ingest.md,
# which the assistant reads at its next session start and relays.
#
# Change for your setup (or export before calling):
#   ASSISTANT_HOME  the assistant's folder               (default ~/Tanya)
#   ASSISTANT_NAME  what the assistant is called          (default Tanya)
#   VAULTS          parent folder of the vaults and _Incoming
#   RUN_HOUR_UTC    two-digit UTC hour to act in          (default 00)
#   and the vault names and review skills in the prompt below.
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin"
# Headless runs never load the Telegram channel; the gateway is the only
# poller. (This line predates the gateway and is kept so the old plugin, if
# ever reinstalled, finds no token here.)
export TELEGRAM_STATE_DIR="$HOME/.claude/channels/telegram-none"
mkdir -p "$TELEGRAM_STATE_DIR"
TANYA="${ASSISTANT_HOME:-$HOME/Tanya}"
NAME="${ASSISTANT_NAME:-Tanya}"
VAULTS="${VAULTS:-$HOME/Dev/Personal/_obsidian}"
RUN_HOUR_UTC="${RUN_HOUR_UTC:-00}"
STATE="$TANYA/state/nightly-ingest"
mkdir -p "$STATE" "$TANYA/inbox"
hour=$(date -u +%H)
if [ "${FORCE:-0}" != "1" ] && [ "$hour" != "$RUN_HOUR_UTC" ]; then exit 0; fi
today=$(date -u +%F)
log="$STATE/$today.log"
lock="$STATE/.lock"
if ! mkdir "$lock" 2>/dev/null; then echo "$(date -u +%FT%TZ) already running" >> "$log"; exit 0; fi
trap 'rmdir "$lock"' EXIT
echo "$(date -u +%FT%TZ) start" >> "$log"
read -r -d '' PROMPT <<EOP
You are $NAME running unattended at $RUN_HOUR_UTC:00 UTC on $today. Do the vault intake and nothing else.

1. Recordings: if any audio or video files sit under $VAULTS/_Incoming or its subfolders, or any Markdown files sit under $VAULTS/_Incoming/fellow or $VAULTS/_Incoming/fieldy (poller transcripts, already transcribed), run the ingest-recordings skill on them. If none, say so and move on.
2. Silo 1 inbox: run the vault-review skill on "$VAULTS/Silo 1" and triage every note in its 00 Inbox except "About the Inbox.md".
3. Silo 2 inbox: run the vault-review skill on "$VAULTS/Silo 2" and triage every note in its 00 Inbox except "About the Inbox.md".

Rules for an unattended run: nobody can answer a question. Where a step needs the owner's decision, leave the item where it is and list it with the question. Commit each vault's changes on its current branch per that vault's CLAUDE.md using structured-git-commits; do not push. Never delete source files in _Incoming; the skills move them.

Finally write $TANYA/inbox/$today-nightly-ingest.md with: what was processed, what was filed where (vault, folder, note), what was left in place and why, and any errors. Keep it under 60 lines. Plain sentences, no dashes.
EOP
cd "$TANYA" || exit 1
claude -p "$PROMPT" --model sonnet --permission-mode auto --add-dir "$VAULTS" --output-format json >> "$log" 2>&1
rc=$?
echo "$(date -u +%FT%TZ) end rc=$rc" >> "$log"
[ -f "$TANYA/inbox/$today-nightly-ingest.md" ] || printf '# Nightly ingest %s\n\nThe run ended with exit code %s and wrote no completion note. See %s.\n' "$today" "$rc" "$log" > "$TANYA/inbox/$today-nightly-ingest.md"
exit $rc
