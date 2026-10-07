#!/usr/bin/env python3
"""Pull new Fieldy conversations into the _Incoming drop zone.

Fieldy is a wearable recorder (fieldy.ai). launchd runs this every five
minutes. It asks the Fieldy Public API v2 for conversations that touch the
window since the last run (minus a two hour overlap), and for each finished
one it has not seen at that updatedAt it fetches the transcript segments and
writes:

  $FIELDY_INCOMING/<YYYY-MM-DD HHMM> <title>.md
      frontmatter, Fieldy's summary and notes, quotes, then the timestamped
      speaker transcript
  $FIELDY_STATE/raw/<conversation id>.json
      {"conversation": ..., "segments": [...]}, the only copy the assistant controls

The ingest-recordings skill (and the nightly run) treat files under
_Incoming/fieldy as already transcribed: classify, route, move. A day of
Fieldy captures mixes ventures and personal life; anything personal is dropped
verbatim into the owner's private vault inbox and nowhere else.

Credentials come only from $FIELDY_ENV_FILE, default ~/.config/fieldy/fieldy.env,
mode 600 (FIELDY_API_KEY, optional FIELDY_LOCAL_TZ). Nothing here prints the
key. Until that file exists the poller exits quietly, so launchd can be
installed before the key arrives.

Change for your setup (environment variables, or edit the defaults below):
  FIELDY_ENV_FILE   the env file holding the key and timezone
  FIELDY_INCOMING   the drop zone folder for Fieldy files
  FIELDY_STATE      runtime state: watermark, raw JSON, log
  FIELDY_LOCAL_TZ   (in the env file) IANA zone for file dates, default UTC

Usage:
  fieldy-poll.py            one poll (what launchd runs)
  fieldy-poll.py --check    verify the key against /user/me and show status
  FORCE=1 fieldy-poll.py    re-pull everything in the window
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HOME = Path.home()
ENV_FILE = Path(os.environ.get("FIELDY_ENV_FILE") or HOME / ".config/fieldy/fieldy.env")
INCOMING = Path(os.environ.get("FIELDY_INCOMING") or HOME / "Dev/Personal/_obsidian/_Incoming/fieldy")
STATE = Path(os.environ.get("FIELDY_STATE") or HOME / "Tanya/state/fieldy")
API_BASE = os.environ.get("FIELDY_API_BASE") or "https://api.fieldy.ai/api/public/v2"
RAW = STATE / "raw"
SEEN = STATE / "seen.json"
LOG = STATE / "poll.log"
OVERLAP = timedelta(hours=2)
FIRST_RUN_LOOKBACK = timedelta(days=14)
PAGE_SIZE = 50          # conversations per page (API max 50)
SEG_PAGE_SIZE = 1000    # transcript segments per page (API max 1000)
MAX_CONV_PAGES = 20
MAX_SEG_PAGES = 10
CALL_GAP = 0.7          # seconds between calls; the key allows 100 per 60 s


def log(msg: str) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}"
    with LOG.open("a") as f:
        f.write(line + "\n")
    print(line)


def load_env() -> dict | None:
    """Return the env values, or None when the file is not there yet."""
    if not ENV_FILE.exists():
        return None
    vals: dict[str, str] = {}
    for raw in ENV_FILE.read_text().splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        vals[k.strip()] = v.strip().strip('"').strip("'")
    if not vals.get("FIELDY_API_KEY"):
        sys.exit(f"FIELDY_API_KEY missing from {ENV_FILE}")
    return vals


def local_tz(env: dict) -> ZoneInfo:
    name = env.get("FIELDY_LOCAL_TZ") or "UTC"
    try:
        return ZoneInfo(name)
    except Exception:
        log(f"WARN unknown FIELDY_LOCAL_TZ {name!r}, using UTC")
        return ZoneInfo("UTC")


_last_call = 0.0


def api(key: str, path: str, params: dict | None = None) -> dict:
    global _last_call
    q = {k: v for k, v in (params or {}).items() if v is not None}
    url = f"{API_BASE}{path}" + (f"?{urllib.parse.urlencode(q)}" if q else "")
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "ea-fieldy-poll/1.0")
    for attempt in range(3):
        wait = CALL_GAP - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                _last_call = time.monotonic()
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            _last_call = time.monotonic()
            text = e.read().decode(errors="replace")[:300]
            if e.code == 429 and attempt < 2:
                log("rate limited, sleeping 61 s")
                time.sleep(61)
                continue
            raise RuntimeError(f"HTTP {e.code} on GET {path}: {text}") from None
    raise RuntimeError("unreachable")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def slug_title(title: str | None) -> str:
    t = re.sub(r"[\\/:*?\"<>|#^\[\]]", " ", title or "Untitled conversation")
    t = re.sub(r"\s+", " ", t).strip()
    return t[:80] or "Untitled conversation"


def hms(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def seg_offset(seg: dict, started: datetime | None) -> float | None:
    """Seconds from the start of the conversation, from whichever field parses."""
    ts = parse_iso(seg.get("timestamp"))
    if ts and started:
        return (ts - started).total_seconds()
    st = seg.get("start")
    if isinstance(st, (int, float)):
        if st > 1e12:                      # epoch milliseconds
            return (st / 1000) - started.timestamp() if started else None
        if st > 1e9:                       # epoch seconds
            return st - started.timestamp() if started else None
        return float(st)                   # already an offset
    return None


def fetch_segments(key: str, conv: dict) -> list[dict]:
    """All transcript segments for one conversation, by id first, by window second."""
    segs: list[dict] = []
    cursor = None
    for _ in range(MAX_SEG_PAGES):
        resp = api(key, "/transcriptions", {
            "conversationId": conv["id"], "pageSize": SEG_PAGE_SIZE, "order": "asc", "cursor": cursor,
        })
        items = resp.get("items") or []
        segs.extend(items)
        cursor = resp.get("nextCursor")
        if not cursor or not items:
            break
    if segs:
        return segs
    # Fallback: the conversation's own time window
    cursor = None
    for _ in range(MAX_SEG_PAGES):
        resp = api(key, "/transcriptions", {
            "startTime": conv.get("startTime"), "endTime": conv.get("endTime"),
            "pageSize": SEG_PAGE_SIZE, "order": "asc", "cursor": cursor,
        })
        items = resp.get("items") or []
        segs.extend(items)
        cursor = resp.get("nextCursor")
        if not cursor or not items:
            break
    return segs


def yaml_str(s: str | None) -> str:
    return '"' + (s or "").replace("\\", "\\\\").replace('"', "'").replace("\n", " ") + '"'


def render(conv: dict, segs: list[dict], tz: ZoneInfo) -> str:
    started = parse_iso(conv.get("startTime"))
    ended = parse_iso(conv.get("endTime"))
    duration = f"{int((ended - started).total_seconds() // 60)} min" if started and ended else ""
    speakers = [s for s in (conv.get("speakers") or []) if s] or sorted({s.get("speaker") or "Unknown" for s in segs})
    sources = sorted({s.get("recordingSource") for s in segs if s.get("recordingSource")})
    loc = conv.get("location") or {}
    place = ", ".join(p for p in [loc.get("city"), loc.get("country")] if p)
    title = conv.get("title") or "Untitled conversation"
    lines = [
        "---",
        "source: fieldy",
        f"fieldy_id: {conv.get('id', '')}",
        f"title: {yaml_str(title)}",
        f"started: {conv.get('startTime') or ''}",
        f"ended: {conv.get('endTime') or ''}",
        f"duration: {duration}",
        f"local_start: {started.astimezone(tz).strftime('%Y-%m-%d %H:%M') + ' ' + tz.key if started else ''}",
        f"type: {conv.get('type') or ''}",
        f"recording_source: [{', '.join(sources)}]",
        f"speakers: [{', '.join(speakers)}]",
        f"keywords: [{', '.join(k for k in (conv.get('keywords') or []) if k)}]",
        f"location: {yaml_str(place)}",
        f"calendar_event: {str(bool(conv.get('calendarEventId'))).lower()}",
        f"fieldy_updated: {conv.get('updatedAt') or ''}",
        f"pulled: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        "---",
        "",
        "> **Fieldy conversation** pulled by fieldy-poll from the owner's wearable. Already "
        "transcribed by Fieldy; do not re-transcribe. Day-to-day capture: it may mix ventures "
        "and personal life. Route personal content verbatim to the owner's private vault inbox and "
        f"nowhere else. Raw JSON: {STATE}/raw/{conv.get('id', '')}.json",
        "",
        f"# {title}",
        "",
    ]
    if conv.get("summary"):
        lines += ["## Summary (Fieldy)", "", conv["summary"].strip(), ""]
    if conv.get("content"):
        lines += ["## Notes (Fieldy)", "", conv["content"].strip(), ""]
    quotes = [q for q in (conv.get("quotes") or []) if q.get("text")]
    if quotes:
        lines += ["## Quotes (Fieldy)", ""]
        for q in quotes:
            ctx = f" ({q['context']})" if q.get("context") else ""
            lines.append(f"- \"{q['text'].strip()}\"{ctx}")
        lines.append("")
    lines += ["## Transcript", ""]
    if not segs:
        lines.append("(empty transcript: Fieldy returned no segments for this conversation)")
    for s in segs:
        off = seg_offset(s, started)
        stamp = f"[{hms(off)}] " if off is not None else ""
        lines.append(f"{stamp}**{s.get('speaker') or 'Unknown'}:** {(s.get('text') or '').strip()}")
    lines.append("")
    return "\n".join(lines)


def check(env: dict | None) -> int:
    print(f"env file : {ENV_FILE} {'present' if env else 'MISSING (poller idles until it exists)'}")
    print(f"incoming : {INCOMING}")
    print(f"state    : {STATE}")
    if not env:
        return 1
    try:
        me = api(env["FIELDY_API_KEY"], "/user/me")
    except RuntimeError as e:
        print(f"key      : REJECTED ({e})")
        return 1
    print(f"key      : OK, Fieldy account {me.get('email', '?')}")
    print(f"timezone : {local_tz(env).key}")
    seen = json.loads(SEEN.read_text()) if SEEN.exists() else {}
    print(f"last run : {seen.get('last_run') or 'never'}; conversations seen: {len(seen.get('conversations', {}))}")
    return 0


def main() -> int:
    env = load_env()
    if "--check" in sys.argv:
        return check(env)
    if env is None:
        return 0  # key not configured yet; launchd keeps calling, nothing to do
    key = env["FIELDY_API_KEY"]
    tz = local_tz(env)
    force = os.environ.get("FORCE") == "1"
    STATE.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    INCOMING.mkdir(parents=True, exist_ok=True)
    seen: dict = json.loads(SEEN.read_text()) if SEEN.exists() else {"conversations": {}, "last_run": None}
    now = datetime.now(timezone.utc)
    since = (datetime.fromisoformat(seen["last_run"]) - OVERLAP) if seen.get("last_run") else now - FIRST_RUN_LOOKBACK
    since_s = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    now_s = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    new = updated = skipped = ongoing = locked = 0
    cursor = None
    pages = 0
    while True:
        resp = api(key, "/conversations", {
            "startTime": since_s, "endTime": now_s, "mode": "intersects-range",
            "pageSize": PAGE_SIZE, "cursor": cursor,
        })
        items = resp.get("items") or []
        pages += 1
        for conv in items:
            cid = conv.get("id")
            if not cid:
                continue
            if not conv.get("endTime"):
                ongoing += 1          # still recording; pick it up when it closes
                continue
            prev = seen["conversations"].get(cid)
            upd = conv.get("updatedAt") or ""
            if prev and prev.get("updatedAt") == upd and not force:
                skipped += 1
                continue
            if conv.get("locked"):
                locked += 1
                if not prev or prev.get("updatedAt") != upd:
                    log(f"locked by plan window, skipped: {cid} {slug_title(conv.get('title'))}")
                seen["conversations"][cid] = {"updatedAt": upd, "locked": True}
                continue
            segs = fetch_segments(key, conv)
            started = parse_iso(conv.get("startTime")) or now
            stem = f"{started.astimezone(tz).strftime('%Y-%m-%d %H%M')} {slug_title(conv.get('title'))}"
            if any(v.get("stem") == stem for k, v in seen["conversations"].items() if k != cid):
                stem = f"{stem} ({cid[:6]})"
            target = INCOMING / f"{stem}.md"
            if prev and prev.get("stem") and not target.exists():
                # already routed into a vault; a regenerated note gets its own file
                target = INCOMING / f"{stem} (update {now.strftime('%Y-%m-%d %H%M')}Z).md"
            (RAW / f"{cid}.json").write_text(json.dumps({"conversation": conv, "segments": segs}, ensure_ascii=False, indent=1))
            target.write_text(render(conv, segs, tz))
            seen["conversations"][cid] = {"updatedAt": upd, "stem": stem, "pulled": now_s}
            updated += 1 if prev else 0
            new += 0 if prev else 1
            log(f"wrote {target.name} ({len(segs)} segments)")
        cursor = resp.get("nextCursor")
        if not cursor or not items or pages >= MAX_CONV_PAGES:
            break

    seen["last_run"] = now.isoformat()
    SEEN.write_text(json.dumps(seen, indent=1))
    log(f"done since={since_s} new={new} updated={updated} unchanged={skipped} ongoing={ongoing} locked={locked} pages={pages}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # one line in the log, never a traceback with secrets
        log(f"ERROR {type(exc).__name__}: {str(exc)[:300]}")
        sys.exit(1)
