# Contributing

Thanks for wanting to improve the guide. It is a recipe other people hand to a
fresh Claude Code session, so every change has to work for someone who is not
the author.

## Proposing a change

1. Open an issue first for anything larger than a typo, saying what broke or
   what is missing and how you found it.
2. Fork, branch from `main`, and keep each commit to one logical change.
3. If you change a file under `templates/`, `agents/`, `commands/`, `skills/`,
   `bin/` or `gateway/`, check that the pointer to it in `GUIDE.md` still says
   what to change in it.
4. Run `bin/build-single-file` and confirm it still produces one readable
   Markdown file.
5. If you touch `gateway/`, run its tests: `cd gateway && bun install &&
   env -u TELEGRAM_BOT_TOKEN bun test`.
6. Open a pull request describing what you changed and why.

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
