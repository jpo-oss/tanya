---
kind: project
project: <slug>
venture: <venture slug>
name: <Display Name>
description: <one line>
status: <active | paused | archived>
repos:
  - path: .
    remote: <git url>
    default_branch: main
    component: <Jira component, if the project requires one>
stack: [<laravel, vue, swift, ...>]
jira:
  project: <KEY>
  board: <board name>
  component: <component or empty>
hosting: <azure | cloudflare | none | unknown>
---

# <Display Name>

## What this is

<Five lines.>

## Repo layout

<Top-level folders and what they hold.>

## Common commands

<Boot, test, lint, build, in fenced blocks. Include the one that bites, for
example a test command that silently targets the dev database without an
.env.testing file.>

## Architecture

<Only what cannot be worked out by grepping the code.>

## How work starts and ships

<Ticket on <KEY> first. Branch `type/<key>-short-name` from origin/main. Build
the whole ticket, local review until clean, open the pull request with the key
in the title and the two-section body, request <Reviewer>.>

## Hard-won rules

<Things that went wrong once and must not again.>
