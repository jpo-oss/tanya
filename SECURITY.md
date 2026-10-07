# Security

## Reporting a vulnerability

Use GitHub's private reporting: the **Security** tab of this repository, then
**Report a vulnerability**. Please do not open a public issue for anything
that could put someone's assistant, inbox or bot token at risk.

Include the file and line, what an attacker needs (a Telegram account, an email
that reaches the inbox, local access to the machine), and steps that reproduce
it. Reports without a working reproduction, including unchecked output from an
AI tool, are closed.

We aim to reply within seven days. There is no bug bounty.

## What is in scope

- `gateway/`: the Telegram daemon, its access control, the pairing flow, the
  local socket, attachment handling and anything that could expose the bot
  token.
- `bin/`: the pollers, the watchdog and the nightly job, including file
  permissions and anything written to logs.
- `templates/hooks/`: hook scripts that run on every Claude Code prompt.
- Instructions in `GUIDE.md`, `skills/`, `agents/` or `commands/` that would
  lead Claude to act on text from an email, a transcript, a Telegram message or
  a vault note as if it came from the owner.

## What the project does not defend against

An assistant built from this guide reads private data (mail, notes,
transcripts), reads content from strangers (anyone can email you or speak in a
meeting), and can act (write files, run shell commands, send Telegram
messages). That combination is what makes prompt injection dangerous, and no
instruction in a Markdown file fully prevents it. The guide reduces the risk
with read-only mail by default, a Telegram allowlist, branch guards and skills
that each do one job, but it cannot remove it. Read
[the security model in the guide](GUIDE.md#8-security-model) before you
connect a mailbox.
