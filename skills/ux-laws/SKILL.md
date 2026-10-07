---
name: ux-laws
description: Use before writing any UI/UX spec, screen, flow, form or navigation, and again at the QA gate. Seven interaction laws (Fitts, Hick, Zeigarnik, Jakob, Goal gradient, Von Restorff, Miller) turned into testable rules, a per-screen checklist, and a deviation log. Complements the design-taste skills, which cover how it looks; this covers how the user decides.
---

# UX laws

A page can pass taste review and still make people think too hard. This skill
is the cognition check. Run it on every screen and every flow before the
design spec is handed to a dev, and again at the QA gate against the built UI.

Source: standard interaction-design canon (Fitts 1954, Hick 1952, Miller 1956,
Zeigarnik 1927, Von Restorff 1933, Hull's goal gradient, Nielsen's Jakob's
law). These rules are mandatory for every UI the dev agents produce.

## The seven laws as rules

Each law has a rule you can check with a yes or no, and a way to measure it.

### 1. Fitts's law: the bigger and closer a target, the easier it is to hit
- One primary action per screen. It is the largest interactive element and
  visually heaviest. If two things look primary, neither is.
- Minimum touch target 44 x 44 pt (iOS), 48 x 48 dp (Android), 44 x 44 CSS px
  on the web, including padding. No exceptions for icons.
- On mobile the primary action sits in the thumb zone (bottom third), not the
  top corner. Destructive actions sit away from it, never adjacent.
- Related controls sit next to the thing they act on (edit beside the field,
  not in a toolbar across the screen).
- Measure: list every tappable element with its size; the primary action is
  the largest; nothing under the minimum.

### 2. Hick's law: more choices mean slower decisions
- At any decision point the user sees at most 5 options. More than that is
  grouped, searched, or revealed progressively.
- One primary call to action per view. Secondary actions are visually quieter
  and fewer.
- Pricing shows at most 3 plans. Add-ons and billing periods are chosen after
  the plan, not alongside it. Never present plans x add-ons x billing as one
  grid.
- Menus: top-level navigation has 5 to 7 items; everything else nests.
- Defaults are preselected wherever a safe default exists, so the common path
  is zero decisions.
- Measure: count options at each decision point; count primary CTAs per view.

### 3. Zeigarnik effect: people remember unfinished tasks
- Every multi-step task shows what is incomplete: "3 of 5 complete", an
  unchecked item, a dashed empty slot. Finished work is visibly closed.
- Unfinished state survives leaving the screen: the user returns to where
  they stopped, with the incomplete marker still there.
- Do not manufacture false incompleteness (fake badges, red dots with nothing
  behind them). Tension must point at a real, finishable task.
- Measure: for each multi-step task, where is "what is left" shown.

### 4. Jakob's law: users spend most of their time on other products
- Search, settings, checkout, sign-in, account, cart, notifications and
  navigation follow the platform convention (Apple HIG, Material, the web's
  common patterns). Search is a magnifier top right or a field top centre.
  Settings is a gear. Checkout is a linear stepper. Back is where the platform
  puts it.
- Novelty is spent only where it is the product's point, and the spec says
  so in one line.
- Icons without labels are allowed only for the dozen universal ones (search,
  settings, close, back, menu, share, delete). Everything else gets a label.
- Measure: list each standard function and the convention it follows; any
  departure has a written reason.

### 5. Goal gradient: motivation rises as the finish gets closer
- Progress indicators start above zero (the first step is "done" the moment
  the user begins) and show the remaining steps by name, not just a bar.
- Long flows are cut into the fewest steps that still make sense; each step
  ends with visible progress.
- Onboarding and setup show a checklist with the easy wins first, so the user
  reaches 50 percent fast.
- Never reset progress silently (a validation error must not send the user
  back to step one).
- Measure: step count, what the indicator shows at step one, what happens on
  error.

### 6. Von Restorff effect: the thing that looks different gets noticed
- One emphasised element per view: one accent-coloured button, one
  highlighted card, one badge. If a second accent is wanted, the spec gives
  a one-line reason.
- Destructive and irreversible actions are the one thing allowed to look
  alarming, and nothing else borrows that colour.
- Marketing emphasis (banners, promos) never competes with the primary task
  action on the same view.
- Measure: count accent-coloured or otherwise emphasised elements per view.

### 7. Miller's law: working memory is small
- Forms are chunked into groups of at most 5 to 7 fields under a heading, and
  one decision per step in a wizard.
- Labels stay visible (above the field), never placeholder-only. Hints and
  formats are shown before the user types, not after an error.
- Numbers people must read or re-type are chunked (card numbers in fours,
  phone numbers by region, codes in groups of 3 or 4).
- Do not ask the user to remember something from a previous screen: carry it
  forward (show the chosen plan on the payment step, the address on the
  confirmation).
- Measure: fields per group, decisions per step, anything the user must hold
  in memory across screens.

## Per-screen checklist

Paste this into the screen's section of `docs/02-design/` and fill it in. A
dash is not an answer.

```
UX laws check — <screen or flow name>
Fitts     primary action: <element>, <size>; smallest target: <element>, <size>
Hick      options at each decision point: <n, n, n>; primary CTAs: <n>
Zeigarnik what shows unfinished state: <where> (or "single-step, n/a")
Jakob     standard functions and conventions: <search: HIG field>, <settings: gear>, ...
Gradient  steps: <n>; indicator at step 1 shows: <...>; on error: <...>
Restorff  emphasised elements: <n> (<which>)
Miller    fields per group: <n>; decisions per step: <n>; carried forward: <...>
Deviations <none> | <law: what, why, one line each>
```

## Deviations

Breaking a rule is allowed when the product needs it. It is never allowed
silently. Each deviation is one line in the checklist naming the law, the
element and the reason, and the lead records anything significant as an ADR in
`docs/decisions/`. QA treats an undocumented deviation as a finding.

## At the QA gate

The qa agent verifies the built UI against the filled checklist, not against
the designer's intent: measure target sizes in the running app or DOM, count
options and CTAs on screen, walk every multi-step flow once and once with an
error injected, and compare standard functions with the platform convention.
Report each rule as PASS, FAIL or DEVIATION-DOCUMENTED with evidence.

## What this skill is not

It is not a style. Pick a design-taste skill for how the product looks and
moves; run this for whether people can use it without thinking. The two never
conflict: when a taste choice breaks one of these rules, the rule wins unless
the deviation is written down.
