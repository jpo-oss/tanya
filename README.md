# Build your own EA

A recipe for a personal executive assistant that runs in
[Claude Code](https://claude.com/claude-code) on your own Mac. It reads your
mail, calendar and Telegram, files your ideas into Obsidian vaults, writes
Jira tickets that both humans and agents can act on, dispatches a team of
specialist coding agents, and survives its own context compaction. It is
modelled on EA Tanya, the assistant Ryan Buswell runs at JustPressOne.

The recipe is one Markdown guide plus the files it links to. You hand it to a
fresh Claude Code session and answer the questions it asks. Claude interviews you in ten short
blocks, reads the answers back, shows you a plan, and builds nothing until you
say yes.

## Five-minute start

1. Install Claude Code and sign in.
2. Clone this repository, or build the single-file version with
   `bin/build-single-file` and copy `build/build-your-own-ea.md` to your home
   folder.
3. Open a terminal there, run `claude`, and say:

   > Read `~/build-your-own-ea.md` and start.

   From a clone, point it at `GUIDE.md` instead; the guide links every file.

4. Answer the interview. Expect about an hour for the first pass, then a
   plan you approve block by block.

## What you get

- A root assistant with a persona file, a registry of your ventures and
  projects, and a day log that survives compaction.
- Skills for parking ideas, ingesting material into vaults, reviewing vault
  inboxes, writing structured Jira tickets and structured git commits.
- Nine specialist developer agents (backend, web, iOS, Android, UI/UX, QA,
  security, DevOps, Azure) and a `run-dev-agents` command that scopes work
  first and dispatches them, with a UX-laws checklist the QA agent enforces.
- Pollers for meeting transcripts (Fellow) and a wearable recorder (Fieldy),
  a nightly vault intake, and a Telegram gateway so you can talk to the
  assistant from your phone.
- Hooks that keep the assistant off your `main` branches and re-inject
  context after a compaction.

## What is where

| Folder | What it holds |
|---|---|
| [`GUIDE.md`](GUIDE.md) | The interview, the build steps, the traps |
| [`templates/`](templates/) | CLAUDE.md files, manifests, vault skeleton, hooks, launchd plists, briefs |
| [`agents/developers/`](agents/developers/) | The nine specialist agents |
| [`commands/`](commands/) | `run-dev-agents`, the project-lead command |
| [`skills/`](skills/) | idea, vault-ingest, vault-review, ingest-recordings, jira-tickets, structured-git-commits, ux-laws |
| [`bin/`](bin/) | Nightly intake, the Fellow and Fieldy pollers, gateway tools, `build-single-file` |
| [`gateway/`](gateway/) | The Telegram gateway and its tests |

## Status

The split and the scrub are done. Section 5 of the guide now lives as real
files under `templates/`, `agents/`, `commands/`, `skills/`, `bin/` and
`gateway/`, and every file was scrubbed of the author's paths, accounts and
identifiers. Tanya, Silo 1 and Silo 2 remain as declared example names. The
repository is private and awaiting the author's read-through before it goes
public.

## Licence

MIT. See [`LICENSE`](LICENSE). The exception is [`gateway/`](gateway/), which
is forked from the official Telegram plugin for Claude Code and keeps that
code's Apache-2.0 licence. Third-party skills the guide installs by
command (for example `leonxlnx/taste-skill`, `blader/humanizer`, the Vercel
`skills` CLI and Anthropic's official plugins) keep their own licences and
are not copied here.

## Credit

Built using vibes by Ryan Buswell and Claude.
