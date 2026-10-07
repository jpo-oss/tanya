#!/usr/bin/env bash
# Transcribe audio or video to text with whisper.cpp, biased by the glossary.
#
# Usage:  transcribe.sh <file-or-directory> [output-directory]
#
# Why the glossary: whisper mangles proper nouns it has not seen. A misspelled
# name produces a [[wikilink]] that points nowhere, so the fact silently never
# reaches that person's note. Always transcribe through this script, never
# whisper-cli directly.

set -euo pipefail

VAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${WHISPER_MODEL:-$HOME/.local/share/whisper-models/ggml-large-v3-turbo.bin}"
# Override for audio from another venture: one vault's glossary biases a
# recording that has nothing to do with it. The router sets this per destination.
GLOSSARY="${WHISPER_GLOSSARY:-$VAULT/System/whisper-glossary.txt}"

[[ $# -ge 1 ]] || { echo "usage: transcribe.sh <file-or-directory> [output-dir]" >&2; exit 2; }
SRC="$1"
OUT="${2:-$(dirname "$SRC")}"

command -v whisper-cli >/dev/null || { echo "ERROR: whisper-cli not found (brew install whisper.cpp)" >&2; exit 1; }
command -v ffmpeg      >/dev/null || { echo "ERROR: ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }
[[ -f "$MODEL" ]]                 || { echo "ERROR: model not found at $MODEL" >&2; exit 1; }

PROMPT=""
if [[ -f "$GLOSSARY" ]]; then
  PROMPT="$(tr '\n' ' ' < "$GLOSSARY")"
  # A LONG GLOSSARY IS WORSE THAN A SHORT ONE. Measured on one clip:
  #   no glossary        -> wrong
  #   40-term glossary   -> still wrong
  #   6-term glossary    -> correct
  # The bias dilutes across terms long before whisper's ~224-token prompt cap.
  words=$(wc -w <<< "$PROMPT")
  if (( words > 40 )); then
    echo "WARNING: glossary is ~$words words, long enough to dilute." >&2
    echo "         Trim it, or pass a focused list for this batch:" >&2
    echo "         WHISPER_GLOSSARY=/path/to/short-list.txt transcribe.sh ..." >&2
  fi
else
  echo "WARNING: no glossary at $GLOSSARY, proper nouns will be mangled." >&2
fi

DONE_STEMS=""
transcribe_one() {
  local f="$1" stem base wav key
  stem="$(basename "${f%.*}")"
  base="$OUT/$stem"
  echo "-> $stem"
  # a.m4a and A.mp4 in one batch would both write a.txt (the Mac ignores case)
  key="$(printf '%s' "$stem" | tr '[:upper:]' '[:lower:]')"
  if [[ $'\n'"$DONE_STEMS" == *$'\n'"$key"$'\n'* ]]; then
    echo "  SKIP: $f would overwrite $base.txt from another file this batch; rename one" >&2
    return 1
  fi
  DONE_STEMS="$DONE_STEMS$key"$'\n'
  wav="$(mktemp "${TMPDIR:-/tmp}/whisper.XXXXXX")"

  # whisper requires 16kHz mono PCM; ffmpeg handles every container we get handed.
  if ! ffmpeg -y -loglevel error -i "$f" -ar 16000 -ac 1 -c:a pcm_s16le -f wav "$wav" 2>/dev/null; then
    echo "  SKIP: ffmpeg could not decode (not audio or video?)" >&2
    rm -f "$wav"; return 1
  fi

  # Write beside the temp wav and move on success, so a failure never leaves
  # an older transcript looking fresh.
  if ! whisper-cli -m "$MODEL" -f "$wav" -np -otxt -of "$wav" \
    ${PROMPT:+--prompt "$PROMPT"} >/dev/null 2>&1 || [[ ! -s "$wav.txt" ]]; then
    echo "  FAIL: whisper-cli produced no transcript" >&2
    rm -f "$wav" "$wav.txt"; return 1
  fi
  rm -f "$wav"
  mv "$wav.txt" "$base.txt" || { echo "  FAIL: could not write $base.txt" >&2; rm -f "$wav.txt"; return 1; }
  echo "  ok $base.txt ($(wc -w < "$base.txt" | tr -d ' ') words)"
}

mkdir -p "$OUT"
if [[ -d "$SRC" ]]; then
  found=0 failed=0
  while IFS= read -r -d '' f; do
    found=1; transcribe_one "$f" || failed=$((failed + 1))
  done < <(find "$SRC" -maxdepth 1 -type f \
        \( -iname '*.m4a' -o -iname '*.mp3' -o -iname '*.wav' -o -iname '*.aac' \
        -o -iname '*.flac' -o -iname '*.ogg' -o -iname '*.opus' -o -iname '*.aiff' \
        -o -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' -o -iname '*.webm' \) -print0)
  (( found )) || echo "No audio or video files found in $SRC" >&2
  (( failed == 0 )) || { echo "$failed file(s) failed" >&2; exit 1; }
else
  transcribe_one "$SRC"
fi
