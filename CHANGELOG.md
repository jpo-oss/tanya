# Changelog

Notable changes to the guide and the code it ships. Dates are UTC.

## Unreleased

First public release, prepared from the private first cut.

- Renamed the project from "Build your own EA" to Tanya.
- Added a security model and a removal section to the guide, an optional-parts
  table at the start, and platform and cost notes in the README.
- Mail setup is read-only by construction: the Microsoft 365 server runs with
  `--read-only` and the Gmail send and delete tools are denied by permission
  rules.
- Fixed the Telegram pairing steps, which checked fields the gateway does not
  write and never switched the policy to `allowlist`.
- Skills that read outside material now say it is data, not instructions.
- Added the Apache-2.0 licence and change notice for `gateway/`, which is
  derived from Anthropic's Telegram plugin.
- Added contributor docs, an AI contribution policy, issue and pull request
  templates, a security policy and CI.
