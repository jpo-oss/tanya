---
name: idea
description: Use when <Person> has a new idea to park, says "/idea", "park this", "new idea", or asks to see parked ideas ("/idea list", "what's parked"). Writes exactly one note into the right vault's Ideas/ folder and nothing else.
---

# /idea, park an idea

One idea becomes one note in one vault. Nothing else is created: no folder, no
repo, no ticket, no project note. Promotion is a separate command.

## `/idea list`

If the argument is `list`: read every `*.md` under `<vault A>/Ideas/` and
`<vault B>/Ideas/`, parse the frontmatter, and print a table grouped by venture:
slug, one-line summary (the first bold line of the body), status, created. Skip
`.gitkeep`. Say "nothing parked" honestly if it is empty. Stop.

## Capturing

<Person> has just described an idea, in this message or the previous few. Work
from what they said. Ask only what you cannot infer, one question at a time, in
this order, skipping any already answered:

1. Venture. Pick from `registry.json`, the `ventures` key. If the text names a
   venture or an obvious product, propose it: "This sounds like <Venture>,
   right?" If it is ambiguous, ask with the slug list. Rules: <the ambiguities
   in your own setup, for instance which venture always goes to which vault>.
2. One-line summary. Propose one sentence; <Person> confirms or edits. The slug
   is that sentence in kebab-case, at most six words, no dates.
3. Type. `code` (becomes a repo), `business` (a venture-level move with no code)
   or `task` (a bounded action). Propose from the text; confirm.

Then check for a collision: if `<vault>/Ideas/<slug>.md` exists, say so and ask
for a different slug. Never overwrite.

## Writing the note

Look up the venture's `vault` and `vault_schema` in the registry. Copy that
vault's `System/Templates/Idea.md`, fill it, and save to
`<vault>/Ideas/<slug>.md`.

Frontmatter by schema, exactly these keys, nothing invented:

- `<schema a>`: `type: idea`, `venture: <slug>`, `status: someday`,
  `created: <today YYYY-MM-DD>`, `promoted_to:` empty.
- `<schema b>`: `type: idea`, `entity: <slug>`, `dept:` empty unless <Person>
  named a department, and then one of the enum, never a free-text name,
  `status: someday`, `created: <today>`, `promoted_to:` empty.

Body: the bold one-liner, then "The idea" written from <Person>'s words cleaned
up, keeping their phrasing where it is specific; "Why now, why not" with anything
they said about timing or doubts; "Open questions" as a checklist of what
promotion will need (stack, name, hosting, who it is for) that they have not said;
and the Log line. Add `idea type: code|business|task` as the first line of "The
idea" so promotion can read it without a schema change.

## After writing

Show the file path and the frontmatter. Say in one line how to promote it later.
Commit the vault on a feature branch with `structured-git-commits`, because the
vault manual requires it. Do not push. Do not touch any other file.
