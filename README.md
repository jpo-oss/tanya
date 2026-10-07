# Tanya

A recipe for a personal executive assistant that runs in
[Claude Code](https://code.claude.com/docs) on your own Mac. You don't install
Tanya. You hand the guide to a fresh Claude Code session, it interviews you,
shows you a plan, and builds your own assistant, with your own name for it, once
you say yes.

Tanya is the name of the assistant Ryan Buswell runs at JustPressOne. The guide
uses it as the worked example throughout; yours will have its own name.

## What it can do once built

- Keep a map of every business and life area you run, and route work to the
  right project instead of doing it in the wrong place.
- File ideas, meeting notes and documents into Obsidian vaults through skills
  that each know one vault's folder layout and frontmatter.
- Write Jira tickets that a person and a coding agent can both pick up, and
  commits that explain why.
- Hand larger builds to a team of nine specialist coding agents with a lead
  that scopes first and waits for your approval.
- Talk to you on Telegram, including voice notes transcribed on your machine.
- Read your mail and calendar (read-only until you decide otherwise).
- Remember what happened today across its own context compactions.

Every one of those is optional except the first two. The guide asks which you
want before it builds anything.

## Getting started

You need a Mac, Claude Code signed in to a paid Claude plan or an API account,
and about an hour.

```bash
git clone https://github.com/jpo-oss/tanya.git
cd tanya
claude
```

Then say:

> Read GUIDE.md and start.

Claude interviews you in ten short blocks, reads each one back, and shows you a
plan. It creates nothing until you approve it. If you only want the core (the
assistant, its registry and one notes vault), say so at the start and the
interview drops the blocks you skip.

If you'd rather hand Claude a single file, run `bin/build-single-file`. It
writes `build/tanya.md` with every linked file inlined. The Telegram gateway is
code rather than a template, so it is not inlined; keep the clone if you want
Telegram.

## What it costs

- Claude usage. The assistant's own session is small, but project sessions and
  scheduled runs add up. [Block J](GUIDE.md#block-j-models-and-context) covers
  the measured numbers and the settings that keep them down.
- Optional services: Fellow's API needs its Enterprise plan, a Fieldy wearable
  is hardware you buy, and Cubic code review has its own pricing.
- About 1.6 GB of disk for the local transcription model.

## Platform support

| | Apple silicon Mac | Intel Mac | Linux |
|---|---|---|---|
| Interview, registry, vaults, skills, agents | yes | yes | yes |
| Telegram gateway | yes | yes | runs, but the guide only ships launchd jobs |
| Apple Mail and Calendar route | yes | yes | no |
| Scheduled runs and pollers | yes (launchd) | yes (launchd) | cron, adapt by hand |

Windows is not supported.

## Before you connect a mailbox

An assistant that reads your mail and also has a shell is exposed to prompt
injection: anyone who can email you can try to give it instructions. The guide
keeps mail read-only, locks Telegram to an allowlist and has each skill do one
narrow job, but none of that makes the risk go away. Read
[the security model](GUIDE.md#8-security-model) first.

## What is where

| Path | What it holds |
|---|---|
| [`GUIDE.md`](GUIDE.md) | The interview, the build steps, the traps |
| [`templates/`](templates/) | CLAUDE.md files, manifests, vault skeleton, hooks, launchd jobs, briefs |
| [`agents/developers/`](agents/developers/) | The nine specialist coding agents |
| [`commands/`](commands/) | `run-dev-agents`, the lead that dispatches them |
| [`skills/`](skills/) | idea, vault-ingest, vault-review, ingest-recordings, jira-tickets, structured-git-commits, ux-laws |
| [`bin/`](bin/) | Nightly intake, the Fellow and Fieldy pollers, Telegram tools, `build-single-file` |
| [`gateway/`](gateway/) | The Telegram daemon and its tests |

## Contributing

Bug reports from people who followed the guide on a real machine are the most
useful thing you can send. See [CONTRIBUTING.md](CONTRIBUTING.md), including
the part about AI-assisted changes, and [SECURITY.md](SECURITY.md) for anything
sensitive.

## Licence

MIT, see [`LICENSE`](LICENSE). The exception is [`gateway/`](gateway/), which
is derived from Anthropic's official Telegram plugin for Claude Code and keeps
its Apache-2.0 licence; see [`gateway/README.md`](gateway/README.md).
Third-party skills the guide installs by command (for example
`leonxlnx/taste-skill`, `blader/humanizer` and Anthropic's plugins) keep their
own licences and are not copied here.

## Credit

Written by Ryan Buswell with Claude Code, from the setup he runs every day.
