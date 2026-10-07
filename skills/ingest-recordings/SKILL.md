---
name: ingest-recordings
description: Use when the owner asks to process, transcribe, or ingest recordings — "ingest my recordings", "transcribe these meetings", "/ingest-recordings", or when audio, video or poller transcripts are waiting in the drop zone.
---

# Ingest Recordings

Transcribe recordings, decide which vault each belongs to, and route it there.

## Configuration

Fill these in once, from `registry.json` and your vault manuals. The skill
never hard-codes a venture or a vault.

| Name | Meaning | Example |
|---|---|---|
| `$INCOMING` | The drop zone, outside every vault | `~/Dev/<Personal>/_obsidian/_Incoming/` |
| Vault A | Path and scope of the default vault | `Silo 1`: everything not claimed by another vault |
| Vault B | Path and scope of each scoped vault | `Silo 2`: one business only |
| `$PRIVATE_INBOX` | Optional: inbox of a private vault for personal captures | `<private vault>/00 Inbox/` |

The drop zone sits outside every vault because a recording's vault is not
known until it has been transcribed and read. Subfolders named after a vault
(`$INCOMING/<vault-a>/`) are a manual override: those files are already routed.

## Procedure

1. **Inventory.** List what is in `$INCOMING` and each of its subfolders,
   including the poller folders (`fellow/`, `fieldy/`). Report counts and total
   duration before starting: a large batch takes real time (about 5.5 times
   faster than realtime, so 10 hours of audio is roughly 2 hours of work).

2. **Transcribe.** Use the vault's script; never call `whisper-cli` directly,
   because the script is what passes the glossary:

   ```bash
   <vault>/System/Scripts/transcribe.sh <file-or-dir> <out-dir>
   ```

   Set `WHISPER_GLOSSARY` to the destination vault's glossary. One business's
   glossary biases a recording that has nothing to do with that business.

   **Poller transcripts arrive pre-transcribed.** `fellow-poll.py` and
   `fieldy-poll.py` write one Markdown file per recording or conversation into
   `$INCOMING/fellow/` and `$INCOMING/fieldy/`: frontmatter (`source`, the
   source id, times, speakers), the service's AI notes, then the timestamped
   speaker transcript. The raw API object is kept under the assistant's
   `state/<job>/raw/`. Never run transcribe.sh on these. Treat the file as the
   transcript: classify from its text, route it as the transcript note (keep
   its frontmatter, add the vault's Transcript template fields, leave `media:`
   empty because the service does not expose audio), write the inbox summary
   draft from the AI notes plus your own reading, and move the file out of the
   drop zone. A file with an empty transcript is a failed or still-processing
   recording: leave it and list it in the questions. A file named
   `<stem> (update <timestamp>).md` is a regenerated note for a recording
   already routed; merge what is new into the existing notes and delete the
   update file.

   **Wearable captures mix work and personal life.** If `$PRIVATE_INBOX` is
   configured, anything personal (family, health, money, anything that is not
   a venture) is dropped there **verbatim** and nowhere else: no summary, no
   vault note, no index entry, no mention in the questions or the nightly note
   beyond "n personal captures filed". A mixed conversation is split by topic
   before routing. When unsure whether a passage is personal, treat it as
   personal.

3. **Classify** each recording by READING its transcript, against the scope
   column of the configuration table. Files under a vault-named subfolder are
   already decided; skip classification. **State your confidence and the
   evidence for every classification** in the report.

4. **Route.** For each confidently classified recording, into the destination
   vault:
   - media goes to `_Media/<YYYY-MM-DD topic>.<ext>` (**move**, don't copy)
   - the transcript goes to `Meetings/Transcripts/<YYYY-MM-DD topic> transcript.md`,
     using that vault's Transcript template, `media:` set to the media filename
   - a summary draft goes to `00 Inbox/Ingest - <YYYY-MM-DD topic>.md`, no
     frontmatter, with the header
     `> **Ingestion note** — source: <path> — transcribed <date>.`

   **The stem rule: the media file, the transcript and the meeting note all
   share one filename stem.** Get it right at routing time; it is painful to
   repair later.

5. **Verify** before reporting done, in each destination vault: run its
   integrity scripts under `System/Scripts/` if it has them, and check that
   every new wikilink resolves.

6. **Commit** in each vault you touched, on its current branch, with the
   structured-git-commits skill, `recordings-N` prefix. Media is gitignored, so
   the commit carries transcripts and notes only; say so in the body.

7. **Report:** per recording, the destination, confidence and a one-line
   subject. Then anything left in the drop zone, and the batched questions.

## Never guess a vault

A recording you cannot confidently classify **stays in the drop zone** and goes
into the batched questions. Reasons to park it:

- It spans two vaults with no clear primary subject.
- The subject is unclear from the transcript.
- It mentions an entity or venture you do not recognise.
- The audio failed to transcribe, or the transcript is too garbled to judge.

Parking one file is cheap. Filing one business's board discussion into another
business's vault means the facts are distilled into the wrong hubs and have to
be unpicked by hand later.

## One recording, one home

A meeting spanning two vaults files to its **primary** vault only. The other
vault's hub gets an `obsidian://` pointer if it matters. **Never duplicate a
transcript across vaults**: two copies drift, and neither is then trustworthy.

## Red flags, STOP

- "It mentions venture X, so it goes to X's vault" → related ventures mention each other constantly. Read for the actual subject.
- "I'll copy it to both vaults to be safe" → No. One home.
- "I'll file it into the hub while I'm here" → No. Inbox only; review distils.
- Calling `whisper-cli` directly → the glossary gets skipped and proper nouns are mangled.
- Deleting the source from the drop zone before the destination note exists → move it as the last step.
- Reporting done without verifying the destination vault.
