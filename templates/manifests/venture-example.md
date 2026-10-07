---
kind: venture
slug: nebulosity
name: Nebulosity
description: Software holding company for the app portfolio; nothing shipped to an app store yet.
vault: "/Users/<you>/Dev/<Personal>/_obsidian/Silo 1"
vault_schema: silo1
hub: Nebulosity
jira:
  site: <your-site>.atlassian.net
  project: <KEY>
github_owner: <your-github-owner>
default_stack: [laravel, vue, swift]
hosting: azure
secrets: unknown
dev_root: /Users/<you>/Dev/Nebulosity
status: active
---

# Nebulosity

Full-platform apps host on Azure; marketing and static sites host on Cloudflare
Workers. Jira <KEY> requires a component on every ticket; component names are
GitHub repo names and are registered in `~/.claude/jira-components.json`. Some
repos still sit under the owner's personal GitHub account; manifests record
what is on disk.
