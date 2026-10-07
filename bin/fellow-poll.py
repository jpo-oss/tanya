#!/usr/bin/env python3
"""Pull new Fellow recordings into the _Incoming drop zone.

launchd runs this every five minutes. It asks Fellow for recordings updated
since the last run (minus a two hour overlap), and for each one it has not
seen at that updated_at writes:

  $FELLOW_INCOMING/<YYYY-MM-DD> <title>.md
      frontmatter, the AI notes, then the timestamped speaker transcript
  $FELLOW_STATE/raw/<recording id>.json
      the raw API object, the only copy of the transcript the assistant controls

The ingest-recordings skill (and the nightly run) treat files under
_Incoming/fellow as already transcribed: classify, route, move.

Credentials come only from $FELLOW_ENV, default ~/.config/fellow/fellow.env,
mode 600 (FELLOW_SUBDOMAIN, FELLOW_API_KEY). Nothing here prints the key.

Change for your setup (environment variables, or edit the defaults below):
  FELLOW_ENV        the env file holding the subdomain and key
  FELLOW_INCOMING   the drop zone folder for Fellow files
  FELLOW_STATE      runtime state: watermark, raw JSON, log
  LOCAL_UTC_OFFSET  hours from UTC for the dates in file names (default 0)
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
ENV_FILE = Path(os.environ.get("FELLOW_ENV") or HOME / ".config/fellow/fellow.env")
INCOMING = Path(os.environ.get("FELLOW_INCOMING") or HOME / "Dev/Personal/_obsidian/_Incoming/fellow")
STATE = Path(os.environ.get("FELLOW_STATE") or HOME / "Tanya/state/fellow")
RAW = STATE / "raw"
SEEN = STATE / "seen.json"
LOG = STATE / "poll.log"
OVERLAP = timedelta(hours=2)
FIRST_RUN_LOOKBACK = timedelta(days=14)
PAGE_SIZE = 20
LOCAL_TZ = timezone(timedelta(hours=float(os.environ.get("LOCAL_UTC_OFFSET", "0"))))  # file dates follow the owner's day


def log(msg: str) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}"
    with LOG.open("a") as f:
        f.write(line + "\n")
    print(line)


def load_env() -> tuple[str, str]:
    if not ENV_FILE.exists():
        sys.exit(f"missing {ENV_FILE}")
    vals = {}
    for raw in ENV_FILE.read_text().splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        vals[k.strip()] = v.strip().strip('"').strip("'")
    sub, key = vals.get("FELLOW_SUBDOMAIN"), vals.get("FELLOW_API_KEY")
    if not sub or not key:
        sys.exit("FELLOW_SUBDOMAIN or FELLOW_API_KEY missing from env file")
    return sub, key


def api(sub: str, key: str, method: str, path: str, body: dict | None = None) -> dict:
    url = f"https://{sub}.fellow.app{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-API-KEY", key)
    req.add_header("Content-Type", "application/json")
    # Fellow sits behind Cloudflare, which answers 403 "error code: 1010" to
    # Python's default User-Agent. Any honest UA passes.
    req.add_header("User-Agent", "ea-fellow-poll/1.0 (curl-compatible)")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")[:300]
            if e.code == 429 and attempt < 2:
                time.sleep(2 + attempt * 3)
                continue
            raise RuntimeError(f"HTTP {e.code} on {method} {path}: {text}") from None
    raise RuntimeError("unreachable")


def slug_title(title: str) -> str:
    t = re.sub(r"[\\/:*?\"<>|]", " ", title or "Untitled recording")
    t = re.sub(r"\s+", " ", t).strip()
    return t[:80]


def hms(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def render(rec: dict) -> str:
    started = rec.get("started_at") or rec.get("created_at") or ""
    ended = rec.get("ended_at") or ""
    segs = ((rec.get("transcript") or {}).get("speech_segments")) or []
    speakers = sorted({s.get("speaker") or "Unknown" for s in segs})
    duration = ""
    try:
        d = datetime.fromisoformat(ended.replace("Z", "+00:00")) - datetime.fromisoformat(started.replace("Z", "+00:00"))
        duration = f"{int(d.total_seconds() // 60)} min"
    except Exception:
        pass
    lines = [
        "---",
        "source: fellow",
        f"fellow_id: {rec.get('id', '')}",
        f"fellow_note_id: {rec.get('note_id', '')}",
        f"title: \"{(rec.get('title') or '').replace(chr(34), chr(39))}\"",
        f"started: {started}",
        f"ended: {ended}",
        f"duration: {duration}",
        f"calendar_event: {str(bool(rec.get('user_has_calendar_event'))).lower()}",
        f"call_url: {rec.get('event_call_url') or ''}",
        f"speakers: [{', '.join(speakers)}]",
        f"language: {(rec.get('transcript') or {}).get('language_code', '')}",
        f"pulled: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        "---",
        "",
        f"> **Fellow recording** pulled by fellow-poll. Already transcribed by Fellow; "
        f"do not re-transcribe. Raw JSON: {STATE}/raw/{rec.get('id', '')}.json",
        "",
        f"# {rec.get('title') or 'Untitled recording'}",
        "",
    ]
    notes = [n for n in (rec.get("ai_notes") or []) if n.get("is_active", True)] or (rec.get("ai_notes") or [])
    if notes:
        lines.append("## AI notes (Fellow)")
        lines.append("")
        for note in notes:
            if note.get("title"):
                lines.append(f"### {note['title']}")
                lines.append("")
            for sec in note.get("sections") or []:
                if sec.get("title"):
                    lines.append(f"#### {sec['title']}")
                    lines.append("")
                content = sec.get("content")
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict):
                            txt = item.get("text") or item.get("content") or json.dumps(item, ensure_ascii=False)
                            ts = item.get("timestamp") or item.get("start")
                            lines.append(f"- {txt}" + (f" ({hms(float(ts))})" if isinstance(ts, (int, float)) else ""))
                        else:
                            lines.append(f"- {item}")
                elif content:
                    lines.append(str(content))
                lines.append("")
    lines.append("## Transcript")
    lines.append("")
    if not segs:
        lines.append("(empty transcript: check Fellow retention settings)")
    for s in segs:
        lines.append(f"[{hms(float(s.get('start', 0)))}] **{s.get('speaker') or 'Unknown'}:** {(s.get('text') or '').strip()}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    force = os.environ.get("FORCE") == "1"
    sub, key = load_env()
    STATE.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    INCOMING.mkdir(parents=True, exist_ok=True)
    seen: dict = json.loads(SEEN.read_text()) if SEEN.exists() else {"recordings": {}, "last_run": None}
    now = datetime.now(timezone.utc)
    if seen.get("last_run"):
        since = datetime.fromisoformat(seen["last_run"]) - OVERLAP
    else:
        since = now - FIRST_RUN_LOOKBACK
    since_s = since.strftime("%Y-%m-%dT%H:%M:%SZ")

    new, updated, skipped = 0, 0, 0
    cursor = None
    pages = 0
    while True:
        body = {
            "pagination": {"cursor": cursor, "page_size": PAGE_SIZE},
            "include": {"transcript": True, "ai_notes": True},
            "filters": {"updated_at_start": since_s},
        }
        try:
            resp = api(sub, key, "POST", "/api/v1/recordings", body)
        except RuntimeError as e:
            if "filters" in str(e) and pages == 0:
                body.pop("filters")
                resp = api(sub, key, "POST", "/api/v1/recordings", body)
            else:
                log(f"ERROR {e}")
                return 1
        block = resp.get("recordings") or {}
        items = block.get("data") or []
        pages += 1
        stop = False
        for rec in items:
            rid = rec.get("id")
            upd = rec.get("updated_at") or ""
            if upd and upd < since_s and "filters" not in body:
                stop = True
                break
            prev = seen["recordings"].get(rid)
            if prev and prev.get("updated_at") == upd and not force:
                skipped += 1
                continue
            started = rec.get("started_at") or rec.get("created_at") or now.isoformat()
            day = datetime.fromisoformat(started.replace("Z", "+00:00")).astimezone(LOCAL_TZ).strftime("%Y-%m-%d")
            stem = f"{day} {slug_title(rec.get('title'))}"
            target = INCOMING / f"{stem}.md"
            if prev and not target.exists():
                # already routed into a vault; a regenerated note gets its own file
                target = INCOMING / f"{stem} (update {now.strftime('%Y-%m-%d %H%M')}Z).md"
            (RAW / f"{rid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1))
            target.write_text(render(rec))
            seen["recordings"][rid] = {"updated_at": upd, "stem": stem, "pulled": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
            if prev:
                updated += 1
            else:
                new += 1
            log(f"wrote {target.name} ({len(((rec.get('transcript') or {}).get('speech_segments')) or [])} segments)")
        cursor = (block.get("page_info") or {}).get("cursor")
        if stop or not cursor or not items or pages >= 25:
            break
        time.sleep(0.4)  # stay under 3 req/s

    seen["last_run"] = now.isoformat()
    SEEN.write_text(json.dumps(seen, indent=1))
    log(f"done since={since_s} new={new} updated={updated} unchanged={skipped} pages={pages}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # one line in the log, never a traceback with secrets
        log(f"ERROR {type(exc).__name__}: {str(exc)[:300]}")
        sys.exit(1)
