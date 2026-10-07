# ~/Dev: <Person>'s ventures and projects

Every Claude session under `~/Dev` loads this file. It explains how the tree is
organised and what applies to every project. The venture list at the bottom is
generated; everything else is hand-written.

## How the tree works

- `~/Dev/<Group>/` is a folder of related projects, one per business group:
  `<Group A>`, `<Group B>`, `<Personal>`. Each has a `CLAUDE.md` group manifest
  naming its member ventures. A group folder never holds code directly.
- `~/Dev/<Group>/<Project>/` is one project. Its `CLAUDE.md` starts with a
  frontmatter block (`kind: project`, `venture`, `repos`, `stack`, `status`)
  that machines read, followed by prose that Claude reads. Some project folders
  are containers holding several repos; the manifest lists them under `repos`.
  Git worktrees inside a container are lanes of one repo, not projects.
- Ventures are finer than groups. The venture manifests live in
  `~/<Name>/ventures/` and say which vault, Jira project and GitHub owner each
  venture uses.
- `~/<Name>/registry.json` is generated from all of this by `refresh-registry`.
  Run it after adding or changing any manifest. Do not edit the registry or the
  generated block below.
- Files at this level and in group or container folders are symlinks into the
  `~/<Name>` repo, placed by `link-hierarchy`. That is how folders which are not
  git repos get versioned `CLAUDE.md` files. Edit them through the link or in
  `~/<Name>`; commit in `~/<Name>`.

## Conventions for every project

- Git rules are global (`~/.claude/CLAUDE.md`): feature branch, micro-commits,
  `structured-git-commits` on every commit.
- Every piece of work is a ticket before it is a branch. Tickets go through the
  `jira-tickets` skill. <Project key> requires a component named after the
  GitHub repo.
- Ticket and pull request bodies carry `## For humans` then `## For AI`.
- Secrets never go in a CLAUDE.md, a manifest, or a vault note. A manifest
  carries a pointer to where secrets live, nothing more.
- Vaults: `<Vault A>` (`<path>`) is the command center across all ventures;
  `<Vault B>` (`<path>`) is `<venture>` only. Each vault's own `CLAUDE.md` is
  its operating manual; follow it when writing there.

## Branches and pull requests

- Start every change with a fresh branch from current `origin/main`:
  `git fetch origin && git checkout -b fix/<key>-short-name origin/main`. The
  branch name carries the ticket key in lower case.
- The pull request title carries the key in brackets:
  `fix(health): alert once per episode [<KEY>-682]`. Use `[no-jira]` only for
  housekeeping that genuinely has no ticket, and expect to be asked why.
- Commit subjects follow `structured-git-commits`. The key goes in the branch
  and the pull request, not the subject.
- One worktree per ticket when several agents run at once:
  `git worktree add ../<repo>-<key> <branch>`. Worktrees share the repo, so
  hooks and config come along.
- `<Reviewer>` reviews and merges. Nobody merges their own pull request. Verify
  every review comment against the code before acting on it, fix the real ones
  as new commits on the same branch, reply on the thread with what you did, and
  re-request review. Never dismiss a review to get past it.

## Code review: run Cubic locally before every push

<!-- Keep this section only if you chose Cubic in block F. With another local
reviewer, keep the rules and change the commands. With none, delete it. -->

Cubic runs in CI on every pull request, but that is the expensive place to find
a bug, because the pull request is already open and the reviewer is already
looking. The local CLI is free, so every code change is reviewed locally first
and a pull request is opened only after the local review is clean.

- When: after the work is done and committed on the feature branch, before
  `git push` and before opening or updating a pull request. Also after each fix
  pass, until clean.
- How: run `/cubic:run-review`. With uncommitted changes it reviews the working
  tree; with a clean tree it reviews the branch against its base. For a longer
  polish loop, `/cubic:cubic-loop` reviews, fixes and re-reviews until clean.
- Clean means no P0 and no P1 findings. P2 and P3 are fixed when real and noted
  in the commit body's Follow-ups when deferred. A finding judged a false
  positive is said so in the commit body, not silently ignored.
- Do not: push or open a pull request to get the CI review instead of running it
  locally; disable or skip the Cubic check in CI; fix a finding by refactoring
  unrelated code.
- Setup once per machine: `curl -fsSL https://cubic.dev/install | bash`, then
  `cubic auth`. If `which cubic` finds nothing, stop and install it. A missing
  CLI is not permission to skip.

## Models and context: keep the window small

Measured over one week: 84 percent of spend was project sessions on the top
model, and almost all of it was cache reads of long contexts, not output. The
rules that follow come from that measurement.

- One ticket, one session. Start a fresh session for the next ticket. Past about
  40 percent of the context window, compact before taking new work, or clear.
- Repo scans, orientation reads and review verification go to Explore or general
  subagents on Sonnet (`model: sonnet`), so file dumps never land in the main
  context. Classification and field lookups go to Haiku.
- Filter long tool output at the shell (grep, head, jq) before it returns. A
  long log is read by a subagent, not pasted.
- Keep recaps and the status line on; they show when to clear.
- Policy and numbers: `~/<Name>/docs/specs/<date>-model-policy.md`.

## Ventures

<!-- ventures:start -->
<!-- ventures:end -->
