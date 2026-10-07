#!/usr/bin/env bun
/**
 * Command-line client for the gateway, behind bin/tg-status.
 *
 *   cli.ts status            one-screen health report, exit 0 healthy / 1 not
 *   cli.ts json              the same as JSON, for bin/tg-watchdog
 *   cli.ts send CHAT TEXT    send a message through the gateway
 *
 * It connects as a "tool", so the gateway never hands it inbound messages.
 *
 * Derived from the telegram plugin in anthropics/claude-plugins-official
 * (commit 1e96c6b), licensed Apache-2.0, and modified. See README.md.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { GatewayClient } from './client'
import { HEARTBEAT, LAUNCHD_LABEL, QUEUE_DIR, SOCKET, localTime, type Status } from './common'

const [cmd = 'status', ...rest] = process.argv.slice(2)
const gw = new GatewayClient({ role: 'tool', label: `cli ${cmd}` }, undefined, undefined, false)
const up = await gw.start()

function queueOnDisk(): number {
  try { return readdirSync(QUEUE_DIR).filter(f => /^\d+\.json$/.test(f)).length } catch { return 0 }
}

/** Seconds since the gateway last wrote its heartbeat, or null if never. */
function heartbeatAge(): number | null {
  try {
    return Math.round((Date.now() - Date.parse(JSON.parse(readFileSync(HEARTBEAT, 'utf8')).ts)) / 1000)
  } catch { return null }
}

async function report(): Promise<Record<string, unknown>> {
  if (!up) {
    return {
      healthy: false,
      gateway: 'down',
      reason: existsSync(SOCKET) ? 'socket file exists but nothing answers' : 'no socket',
      heartbeat_age_s: heartbeatAge(),
      queue: queueOnDisk(),
    }
  }
  const s = (await gw.request('status', {}, 5000)) as Status
  const pollAge = s.last_poll_ok ? Math.round((Date.now() - Date.parse(s.last_poll_ok)) / 1000) : null
  // A long poll returns at least every 30 s, so 120 s without one means
  // Telegram is unreachable or something else took the bot.
  const pollOk = pollAge !== null && pollAge < 120
  return {
    healthy: pollOk,
    gateway: 'up',
    ...(pollOk ? {} : { reason: pollAge === null ? 'has not reached Telegram yet' : `no successful poll for ${pollAge}s` }),
    ...s,
    poll_age_s: pollAge,
    heartbeat_age_s: heartbeatAge(),
  }
}

switch (cmd) {
  case 'json': {
    const r = await report()
    console.log(JSON.stringify(r))
    gw.close()
    process.exit(r.healthy ? 0 : 1)
  }
  case 'status': {
    const r = await report()
    if (r.gateway === 'down') {
      console.log(`Gateway:  DOWN (${r.reason})`)
      console.log(`Queue:    ${r.queue} message(s) saved on disk`)
      console.log(`Restart:  launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}`)
    } else {
      console.log(`Gateway:  up as @${r.bot}, pid ${r.pid}, since ${localTime(new Date(String(r.started_at)))}`)
      console.log(`Telegram: ${r.healthy ? `reachable, last poll ${r.poll_age_s}s ago` : `PROBLEM, ${r.reason}`}`)
      console.log(`Session:  ${r.channels ? `connected (${r.channels})` : `NOT connected${r.down_since ? ` since ${localTime(new Date(String(r.down_since)))}` : ''}`}`)
      console.log(`Queue:    ${r.queue} message(s) waiting`)
    }
    gw.close()
    process.exit(r.healthy ? 0 : 1)
  }
  case 'send': {
    const [chat_id, ...words] = rest
    if (!up || !chat_id || !words.length) {
      console.error(up ? 'usage: cli.ts send CHAT_ID TEXT' : 'gateway is not running')
      process.exit(1)
    }
    console.log(await gw.request('send', { chat_id, text: words.join(' ') }))
    gw.close()
    process.exit(0)
  }
  default:
    console.error('usage: cli.ts status | json | send CHAT_ID TEXT')
    process.exit(2)
}
