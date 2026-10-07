# Contributing

Thanks for wanting to improve the guide. It is a recipe other people hand to a
fresh Claude Code session, so every change has to work for someone who is not
the author.

## What helps most

A report from someone who followed the guide on a real machine: which step,
what you ran, what happened, and what you expected. Traps you hit that section 7
doesn't mention are especially welcome.

## Proposing a change

1. Open an issue first for anything larger than a typo, saying what broke or
   what is missing and how you found it.
2. Fork, branch from `main`, and keep each commit to one logical change. Commit
   messages follow [`skills/structured-git-commits`](skills/structured-git-commits/SKILL.md).
3. If you change a file under `templates/`, `agents/`, `commands/`, `skills/`,
   `bin/` or `gateway/`, check that the pointer to it in `GUIDE.md` still says
   what to change in it.
4. Run the checks in [`AGENTS.md`](AGENTS.md#commands). CI runs the same ones.
5. Open a pull request and fill in the template.

## Using AI tools

This project is built with Claude Code and is about Claude Code, so using AI to
help you contribute is fine. Which tool you use is up to you; the rules below
are about who answers for the result.

- You are the author. You must be able to explain every line of your change
  without the tool that helped write it. If you can't, don't send it.
- Say what helped. The pull request template asks which tool you used and what
  it did. Add an `Assisted-by: <tool>` trailer to commits where a tool wrote a
  meaningful part.
- Run it. A change to the guide has been followed on a real machine; a change
  to code has been executed and its tests pass. Paste the output.
- A person opens every pull request and every issue. Agents acting on their
  own, without a person reading what they produced first, get closed.
- Keep it small. One problem per pull request. Large unrequested rewrites of
  the guide, especially ones that change its voice, will be declined.
- Security reports need a reproduction you ran yourself. Unchecked AI output
  is closed without discussion.

Maintainers may close anything that reads as unreviewed tool output without a
detailed review.

## Templates stay generic

Everything here is a template. Use `<angle-bracket>` placeholders, `$HOME` or
an environment variable with a clearly fake default for anything that differs
between people. Tanya, Silo 1 and Silo 2 are the author's names kept as worked
examples; do not add your own assistant's or company's names alongside them.

## No real identifiers

A pull request that contains any of these is closed without review:

- API keys, bot tokens, OAuth secrets or anything shaped like one
- Telegram chat ids, phone numbers, email addresses or messaging handles
- Ticket keys, Atlassian site names or cloud ids from a real instance
- Account, company registration or tax numbers
- Paths that contain a real user name

Before you push, grep your diff for long digit runs, `@`, `atlassian.net` and
`/Users/`. Test fixtures use obviously fake values such as `111` and
`+10000000000`.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
