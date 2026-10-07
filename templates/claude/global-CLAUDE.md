# Git workflow (applies to every project)

## Branching

- Never work directly on `main` or `master`. Before touching any file, create a
  feature branch: `git checkout -b <type>/<short-name>`, for example
  `feature/login-form` or `fix/reset-email`. A PreToolUse hook enforces this by
  blocking edits on main.

## Micro-commits

- Commit early and often: one commit per small, logical unit of work. A single
  function, a bug fix, a config change, one component. Never batch a whole
  feature or phase into one commit.
- Commit as soon as a unit works (compiles, tests pass), not at the end of the
  session.
- If a change touches several areas, split it into one commit per area.

## Commit messages

- Every commit follows the `structured-git-commits` skill: a
  `<prefix>-<number>: <summary>` subject plus the full What / Why / How / Files /
  Follow-ups handoff body. Invoke that skill before every commit, with no
  exceptions, even for tiny changes.

# Dev agents and design skills (applies to every project)

- Large builds run through `/run-dev-agents` (`~/.claude/commands/run-dev-agents.md`): the project lead scopes docs first, then dispatches the specialist agents in `~/.claude/agents/developers/`. Use it for anything bigger than a single fix.
- Every UI the agents produce follows two user-level skills: `ux-laws` (seven interaction laws as a per-screen checklist, verified by qa at the gate) and one design-taste skill from `leonxlnx/taste-skill` (`design-taste-frontend` by default; `gpt-taste` for GSAP-driven motion; `redesign-existing-projects` for existing UIs). These live in `~/.claude/skills/` and are available in every project; if one is missing from the skills list, say so instead of freehanding.
