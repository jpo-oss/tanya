# <Vault> Claude Operating Manual

This vault is <what it is: a command center across all ventures, or one
business's knowledge base>. Any Claude session working here follows this manual.
<Person> makes the judgment calls; Claude does the mechanical work.

<If there are two vaults, say in two sentences which is which and that
duplication between them is expected and accepted, so no session tries to
migrate one into the other.>

## Structure

| Folder | What lives here |
|---|---|
| `00 Inbox/` | Raw capture. Anything, any format. Filed during review. |
| `01 Projects/` | Work with an end state. One note per project. |
| `Ideas/` | Parked ideas captured by `/idea` (`type: idea`, `status: someday`). Promoted into a project, which sets `status: active` and `promoted_to`. Dropped ideas become `done` and move to Archive. |
| `02 Areas/` | Ongoing responsibilities: venture hub notes and life areas. |
| `03 Resources/` | Knowledge base. Reference, not action. |
| `04 Archive/` | Done and dead notes. Moved here, never deleted. |
| `People/` | One note per person: who they are, stakes, history, open items. |
| `Meetings/` | Meeting records, named `YYYY-MM-DD <topic>`. |
| `Meetings/Transcripts/` | Full raw transcripts of recordings. |
| `Daily/` | Daily notes, `YYYY-MM-DD`. Scratchpad; capture is promoted out during review. |
| `System/` | Templates, scripts, glossary. Not content. |
| `_Media/` | Gitignored. Raw audio, video, scans, source PDFs. |

## Metadata schema

Every note gets frontmatter. Keep it exactly this small. Do not invent new
types, properties or slugs without <Person>'s approval.

```yaml
type: project | area | resource | person | meeting | daily | idea
venture: <slug> | <slug> | <slug>
status: active | waiting | someday | done    # projects and ideas
due: YYYY-MM-DD                              # optional, projects only
date: YYYY-MM-DD                             # meetings and transcripts
media: "<YYYY-MM-DD topic>.m4a"               # optional, filename in _Media/
created: YYYY-MM-DD                          # ideas only, the day it was parked
promoted_to: "~/Dev/<Group>/<project>"        # ideas only, empty while parked
```

Life-area notes and their projects use `venture: personal` and link to their
area hub, so the hub's dashboard view picks them up through that link.

## Venture slugs

- `<slug>` for [[<Hub note name>]] (<one clause of context>)
- `<slug>` for [[<Hub note name>]] (<one clause of context>)

## Naming conventions

| Kind | Pattern | Example |
|---|---|---|
| Meeting | `YYYY-MM-DD <topic>` | `2026-09-16 Board call` |
| Transcript | `YYYY-MM-DD <topic> transcript` | `2026-09-16 Board call transcript` |
| Media file | `YYYY-MM-DD <topic>.<ext>` | `2026-09-16 Board call.m4a` |
| Person | Full name | `<Full Name>` |
| Project | Outcome-shaped, sentence case | `Register the foundation` |
| Ingest note | `Ingest - <topic>` | `Ingest - 2026-09 board pack` |
| Daily | `YYYY-MM-DD` | `2026-09-16` |
| Idea | kebab-case slug | `year-end-party-app` |

The stem rule: a recording's media filename stem is identical to its transcript
and meeting note stem. That makes the media and note relationship auditable at
any volume.

## Filing rules (inbox triage)

1. Read the inbox item. Decide: actionable with an end state goes to a project;
   part of an ongoing responsibility goes to a note under the area or venture,
   or a log entry in the hub; reference goes to resources; about a person
   updates the People note; a meeting record goes to Meetings.
2. Apply the template, fill the frontmatter, link the venture hub and any
   `[[People]]` mentioned.
3. Ambiguous items: ask <Person>, do not guess. Batch the questions at the end
   of triage.
4. Raw capture notes (`Ingest - *`) are deleted once fully distilled, because
   git history preserves them. Cite the preserving commit in the review report.
   Everything else is never deleted; finished and dead notes move to
   `04 Archive/`.

## Review script ("run my review")

1. Triage `00 Inbox/` per the filing rules. Sweep recent `Daily/` notes for
   un-promoted capture.
2. Update project statuses: finished becomes `done` and moves to Archive;
   blocked becomes `waiting` with an explicit note on what it is waiting for.
3. Surface stalled projects (no edits in 14 or more days), `waiting` items, and
   projects past `due`.
4. Deliver a one-screen briefing grouped by venture, then ask the batched
   judgment questions.
5. Commit the changes and push.

## Recordings

Recordings arrive via `/ingest-recordings`, which transcribes everything dropped
in `<drop zone path>` and routes each file to the right vault. <Say which vault
is the default destination, and name the exception that trips people up.>

- Media goes to `_Media/`, which is gitignored. The remote does not back it up;
  it needs its own backup.
- Transcript goes to `Meetings/Transcripts/<YYYY-MM-DD topic> transcript.md`.
- A summary draft goes to `00 Inbox/`, distilled by the next review.

Transcription is local: whisper.cpp with `large-v3-turbo`, biased by
`System/whisper-glossary.txt`. Without the glossary, proper nouns get mangled,
and a misspelled name produces a `[[wikilink]]` that points nowhere, so the fact
silently never reaches that person's note.

Keep the glossary short. A long glossary is measurably worse than a short one,
because the bias dilutes across terms long before whisper's prompt cap.
Reviews curate it; they do not append to it.

## Conventions

- Note names are plain, human and sentence-style. Meetings and dailies are
  prefixed `YYYY-MM-DD`.
- People notes use full names once known. Upgrade a first-name-only note with an
  Obsidian-safe rename so links follow.
- Dashboards are Obsidian Bases code blocks. Edit the YAML carefully; broken
  YAML kills the view silently.
- Report empty results honestly. Never manufacture findings.
- Teach while working: one short paragraph when <Person> sees something new.

## Git

This vault is a git repo. Follow the global git rules: feature branch,
micro-commits via `structured-git-commits`. Reviews end with a commit so the
history reads as a log of this vault's evolution.

Remote: `github.com/<you>/<vault>-vault`, private. Default branch `main`.

This vault must never be made public. <Say what is in it that makes that true:
tax IDs, bank details, payroll, client pricing, statutory filings.>

Auto-push: every review ends with `git push` after its commits. The remote is
the backup.
