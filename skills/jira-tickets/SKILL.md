---
name: jira-tickets
description: Use when creating or editing ANY Jira issue (createJiraIssue, editJiraIssue, "file a ticket", "log this as a bug", "make Jira tickets", bulk ticket creation from an audit or review). Enforces the required "For humans" / "For AI" description structure, the repo-named component, and a humanizer pass on the prose.
---

# Writing Jira tickets

Every Jira issue you create has the same shape. A person triaging the backlog and an agent picking up the work read the same ticket and need different things from it, so the description carries both, explicitly separated.

A `PreToolUse` hook blocks `createJiraIssue` and `editJiraIssue` calls that violate the two hard rules below. If a call is rejected, fix the ticket rather than working around the hook.

## Hard rules

1. **Description contains `## For humans` and `## For AI`**, in that order, both non-empty.
2. **The issue carries a component** naming the GitHub repo the work belongs to.

## Components

The component is the GitHub repo name, **verbatim**: `MyApp`, `my-app-ios`, `my-app-web`. No lowercasing, no kebab-casing, no org prefix. The repo name is the only identifier that already exists and is already unique, and an exact match means there is never a question of which component a repo maps to.

Components are what route work onto the kanban boards. They are a picklist, so unlike labels nobody can invent a near-miss value that silently falls off a board.

The registry lives at `~/.claude/jira-components.json`, keyed by Jira project. It is what the hook reads. A project's entry looks like this:

```json
{
  "<KEY>": {
    "site": "<your-site>.atlassian.net",
    "org": "<your-github-owner>",
    "enforce": true,
    "fallback": "Unassigned",
    "components": ["MyApp", "my-app-ios", "my-app-web", "Unassigned"]
  }
}
```

An exception is allowed when it is written down: a component that covers a whole initiative rather than one repo, with the date and the reason recorded next to it.

Pass it on create:

```json
"additional_fields": { "components": [{ "name": "MyApp" }] }
```

A ticket spanning two repos carries both components. That is normal and preferable to picking one.

### `Unassigned`

`Unassigned` is the component for work that genuinely belongs to no repo: process, ops, business admin, an epic that has not been broken down yet. It is a triage signal, meaning "this still needs a home", not a parking spot. Never reach for it to get past the hook.

### Adding a repo

Jira rejects a component that does not exist in the project, and the MCP cannot create one. Adding a repo takes two steps:

1. Create the component in Jira (Space settings → Components), named exactly as the repo.
2. Add it to the `components` array for that project in `~/.claude/jira-components.json`.

A component that is missing from the registry only produces a warning, so a brand-new repo can be ticketed the moment the Jira component exists. A missing Jira component is a hard failure from Jira itself.

### Projects not in the registry

A Jira project absent from the registry is not enforced. Every other project on `<your-site>.atlassian.net` keeps working as before. Follow whatever convention that project already uses, and add the project to the registry when its component scheme is confirmed.

### Judge a create by a read-back

A project whose create screen includes Components and Labels accepts both on `createJiraIssue`. Pass them in `additional_fields` and they stick; one call is enough.

The trap: **the `createJiraIssue` response omits `components` and `labels` from the issue it echoes back**, so a create that worked looks like a create that silently dropped the field. Reading the echo once produced a wrong conclusion that sat in this skill for days, until a JQL read-back of a batch of sixteen issues showed every component and label present.

So: judge a create by a read-back, never by its own response.

```
project = <KEY> AND component IS EMPTY
```

Run that after any batch create. It should return nothing.

## Labels

Labels are now optional and cross-cutting only. The component carries the product, so a label that just repeats the repo name is noise.

Use labels for things that span repos or are temporary: `security`, `tech-debt`, `regression`, a severity, a release push, an initiative name. Kebab-case.

One reason to also carry a product label: components are dropped when an issue moves to a different Jira project, labels survive. If an app is likely to graduate into its own Jira project, a label is cheap insurance.

## The two sections

### `## For humans`

Prose. What is broken, why it matters, what needs deciding. Written for someone with context on the product but not on this file.

Run it through the `humanizer` skill before posting. In particular:

- No em dashes or en dashes. Use commas, periods, parentheses.
- No "not X but Y" constructions.
- No one-line closers that restate the paragraph above.
- No bold labels decorating a list.
- No inflated significance. State the fact and stop.
- Plain verbs. "is" and "has", not "serves as" or "represents".

Say plainly when something is a product decision rather than an engineering one, and address the owner by name when their call is needed. Say when a claim is measured versus inferred.

### `## For AI`

Everything an agent needs to do the work without re-deriving it.

- File paths with line numbers.
- The exact command to reproduce, in a fenced block.
- Expected versus actual, with real error text.
- The precise change, as a diff or a code block.
- A verify command, and what its passing output looks like.
- **What not to do.** Workarounds to avoid, rules not to disable, scope to leave alone. This matters as much as the instructions.
- Cross-references to sibling tickets by key.

State measurements as measurements. "27 INSERTs on a 50-row invoice list, measured on the demo dataset" beats "causes excessive writes".

## Grouping

When filing more than three tickets at once, create an Epic first and parent the rest to it. The epic groups the initiative, the component groups the codebase, and they are independent: one epic can span several components.

The epic needs a component and both description sections, exactly like a child. The hook does not exempt it. Write the epic's `## For humans` as the orientation a person needs before picking up any child, and its `## For AI` as the shared repo, scope and suggested order.

Epics created before the hook existed may have neither section. They are fine as they stand, because the hook only inspects an edit that rewrites the description. Rewriting one means adding both sections in the same edit.

## Key allocation

Other people create issues in shared projects concurrently. **Never assume the next key.** If ticket A references ticket B, create both, read back the real keys, then fix the references with `editJiraIssue`. Verify with a JQL query on the epic before declaring done.

## Connection gotcha

If `getAccessibleAtlassianResources` fails (for example with an IP-allowlist error), pass the site hostname directly as `cloudId` (`<your-site>.atlassian.net`) and every other call works.

## Template

```markdown
## For humans

<What is broken and what it costs. Two to five short paragraphs.>

<Any decision that is the owner's to make, named as such.>

## For AI

**File:** `path/to/file.ext:LINE`

**Reproduce:**
```bash
<command>
```

**Expected:** <...>
**Actual:**
```
<real error text>
```

**Root cause:** <...>

**Change:**
```<lang>
<the fix>
```

**Verify:**
```bash
<command>
```
<what passing looks like>

**Do not:** <workarounds to avoid, scope to leave alone>

**Related:** <KEY>, <KEY>
```
