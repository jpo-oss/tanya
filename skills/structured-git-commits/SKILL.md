---
name: structured-git-commits
description: Use when creating any git commit (committing changes, "commit this", saving work to git, before push) in any project. Enforces a category-prefix + incrementing-number subject (e.g. api-4, ui-2) and a detailed developer-handoff body.
---

# Structured Git Commits

## Overview

Every git commit MUST follow a consistent, self-documenting structure so a
developer who has never seen the project can pick it up and understand exactly
what was done, why, and what is left to do. This matters especially for
vibecoded projects being handed off to a professional developer.

Two rules, always:

1. **Subject line** = `<prefix>-<number>: <concise summary>`
2. **Body** = full handoff notes (What / Why / How / Files / Follow-ups)

**A commit without this structure is incomplete. Do not skip the body, even for "tiny" changes.**

## The Subject Line

Format: `<prefix>-<number>: <concise summary>`

Examples: `core-1: Scaffold project`, `api-4: Add password reset endpoint`, `ui-2: Build login form`

### Choosing the prefix (dynamic, per-project)

There is **no fixed global list**. The prefix names the *area of the project*
the change belongs to, derived from THIS project's own structure (its folders,
modules, features, or domains). Examples of areas that might become prefixes:
`core`, `api`, `ui`, `db`, `auth`, `payments`, `emailer`, `infra`, `docs`, `test`.

**Before choosing, ALWAYS check what prefixes this repo already uses and reuse them.**
Consistency across the project matters more than a perfect name. Only invent a
new prefix when the change is genuinely in an area no existing prefix covers.

List existing prefixes:
```bash
git log --pretty=format:%s | grep -oE '^[a-z0-9]+-[0-9]+' | sed 's/-[0-9]*$//' | sort -u
```

If the repo has no history yet, pick a prefix that fits the area of the change
(a first commit is usually `core-1`).

### Choosing the number (per-prefix, per-project)

Each prefix has its **own** counter that increments within this repo. `core`
counts `core-1, core-2, core-3...` independently from `api-1, api-2...`.

Find the next number for a prefix (replace `PREFIX`):
```bash
git log --pretty=format:%s | grep -oE '^PREFIX-[0-9]+' | grep -oE '[0-9]+$' | sort -n | tail -1
```
Add 1 to the result. If it returns nothing, this is the first; start at `1`.

## The Body (full handoff notes)

Every commit body MUST contain these sections, in this order:

```
What:  <what changed, in plain language>
Why:   <the reason / goal / problem being solved>
How:   <how it works: key approach, decisions, anything non-obvious>

Files:
- path/to/file: what changed here and why
- path/to/other: ...

Follow-ups:
- <known gaps, TODOs, risks, or "none">
```

Write for someone who has never seen the code. Prefer plain language over
jargon. If there are no follow-ups, write `- none`.

## Making the commit

Use a HEREDOC so the multi-line body is preserved exactly:

```bash
git commit -m "$(cat <<'EOF'
api-4: Add password reset endpoint

What:  New POST /auth/reset endpoint that emails a reset link.
Why:   Users had no way to recover accounts; support was doing it manually.
How:   Generates a signed, 30-min-expiry token, stores its hash in the
       password_resets table, and sends the link via the existing mailer.

Files:
- src/routes/auth.js: added the /auth/reset route and validation
- src/services/resetToken.js: new: token generation + verification
- migrations/007_password_resets.sql: new table for reset tokens

Follow-ups:
- Rate-limiting on the endpoint is not yet added (abuse risk)
- Reset email copy is placeholder text, needs review
EOF
)"
```

If an agent wrote the change, add its co-author trailer as the final line of
the body, naming the model that actually did the work:
```
Co-Authored-By: <model name> <noreply@anthropic.com>
```

## Quick Reference

| Step | Action |
|------|--------|
| 1 | `git status` / `git diff`: know what changed |
| 2 | List existing prefixes; reuse the matching one, or pick a new area name |
| 3 | Find the highest number for that prefix; add 1 |
| 4 | Write subject: `prefix-number: summary` |
| 5 | Write body: What / Why / How / Files / Follow-ups |
| 6 | Commit with the HEREDOC pattern above |

## Common Mistakes

- **Skipping the body on "small" changes**: every commit gets full notes. Small changes still need a Why.
- **Inventing a new prefix when one already fits**: always check existing prefixes first.
- **Sharing one counter across prefixes**: each prefix increments independently.
- **Vague summaries** ("fixes", "updates"): say what and where: `ui-3: Fix overlapping labels on mobile nav`.
- **Listing files without saying why**: each file line explains the change, not just the path.
- **Omitting Follow-ups**: if none, write `- none`; never leave it out.
