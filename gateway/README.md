# Telegram gateway

This folder holds the small daemon that connects the assistant to Telegram.
One long-running process owns the bot token, polls Telegram and saves every
accepted message to disk. Assistant sessions connect to it over a local socket
to receive those messages and to send replies, so a session never holds the
token and a message is not lost when no session is running.

## Origin and licence

The code is forked from the Telegram plugin in
[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram),
at commit `1e96c6b0a0f06cad576086243f3d06397c4ddf44`. That plugin is licensed
under the Apache License 2.0, and so is this fork. See `LICENSE`. Each source
file carries a note that it is derived from the plugin and has been modified.

## How it differs from the plugin

- A single daemon (`gateway.ts`, kept alive by launchd) owns polling. The
  plugin polled from inside each session and took over the bot from a pid file.
- Accepted messages are written to an on-disk queue before the Telegram offset
  moves. If the disk write fails, Telegram is asked for the message again.
- Sessions load `channel.ts`, which talks to the daemon over a unix socket and
  holds no token. `cli.ts` is a status and send tool on the same socket.
- Failures are reported to the owner on Telegram: the session dropped, a
  message is waiting with no session, or a session took a message and sent
  nothing back.
- A message stays queued after a session acknowledges it, until that session
  has clearly seen it: it replied to or reacted on that message (or a later
  one), or it was acknowledged before the session's previous reply began.
  Otherwise the next session gets it again, marked `redelivered="true"`.
- Messages queued from a group are dropped at delivery if the group, or the
  sender's place in it, has since been removed.
- New messages go to the most recently connected session.
- The permission relay is not carried over.

Hardening added on top:

- Downloads from Telegram time out after two minutes.
- A failure to read `access.json` is retried rather than treated as corruption;
  only invalid JSON is moved aside.
- The check that stops the bot's own state (token, access list) being sent as
  an attachment resolves real paths, compares them case-insensitively on macOS
  and refuses when a path cannot be checked.
- Queued messages are checked against the allowlist again before delivery, so
  a removed sender's backlog is dropped.
- Socket input is decoded as UTF-8 across chunk boundaries; malformed requests
  are ignored.
- Long replies are split without breaking emoji; replies may carry files with
  no text; images over 10 MB are sent as documents.
- A photo that fails to download keeps its `file_id` so the session can retry.
- The channel server does not show the same message twice after a reconnect.
- Files the daemon writes are private to the owner (umask 077, folders 0700),
  and the bot token is removed from log lines and socket errors.
- Values in the bot's `.env` may be wrapped in quotes.

## Tests

The tests start a real gateway against a fake Telegram server on localhost,
with all state in a temporary folder. They never touch the real bot.

```bash
cd gateway
bun install
env -u TELEGRAM_BOT_TOKEN bun test
```

The watchdog tests also need `python3`.
