/**
 * Shared paths, settings and the socket wire format for the Telegram gateway.
 *
 * Two programs use this: gateway.ts (the always-on daemon that owns the bot)
 * and channel.ts (the per-session MCP server). cli.ts is a third, tiny client.
 * Design: section G of GUIDE.md.
 *
 * Every path and threshold can be overridden by an environment variable so
 * the test suite can run a second gateway against a fake Telegram without
 * touching the real bot or the real queue.
 */
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'

const HOME = homedir()

/** The assistant's display name, used in every notice the owner reads. */
export const EA_NAME = process.env.ASSISTANT_NAME ?? 'Tanya'
const SLUG = EA_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')
/** The assistant's own folder; state lives under it. */
export const EA_HOME = process.env.ASSISTANT_HOME ?? join(HOME, EA_NAME)
/** The alias that resumes the assistant's session. */
export const RESUME_CMD = process.env.TG_RESUME_CMD ?? `${SLUG}-resume`
/** What to call the machine the assistant runs on, in notices. */
export const MACHINE = process.env.TG_MACHINE_LABEL ?? 'the Mac'
/** The MCP server name the session loads, and the channel tag's source. */
export const CHANNEL_NAME = process.env.TG_CHANNEL_NAME ?? `${SLUG}-telegram`
/** The launchd label of the gateway job. */
export const LAUNCHD_LABEL = process.env.TG_LAUNCHD_LABEL ?? `com.${SLUG}.telegram-gateway`

/** Token, access.json, approved/ and inbox/ — unchanged from the plugin. */
export const BOT_DIR =
  process.env.TELEGRAM_STATE_DIR ?? join(HOME, `.claude/channels/telegram-${SLUG}`)
/** Queue, socket, heartbeat and logs. Git-ignored under <assistant>/state. */
export const GW_DIR = process.env.TG_GATEWAY_DIR ?? join(EA_HOME, 'state/telegram')

export const ENV_FILE = join(BOT_DIR, '.env')
export const ACCESS_FILE = join(BOT_DIR, 'access.json')
export const APPROVED_DIR = join(BOT_DIR, 'approved')
export const INBOX_DIR = join(BOT_DIR, 'inbox')

export const QUEUE_DIR = join(GW_DIR, 'queue')
export const DONE_DIR = join(QUEUE_DIR, 'done')
export const SOCKET = join(GW_DIR, 'gw.sock')
export const HEARTBEAT = join(GW_DIR, 'heartbeat.json')
export const OFFSET_FILE = join(GW_DIR, 'offset')
export const LOG_FILE = join(GW_DIR, 'gateway.log')

const ms = (name: string, fallback: number) => Number(process.env[name] ?? fallback)

/** No session for this long after one dropped: tell the owner. */
export const DOWN_NOTICE_MS = ms('TG_DOWN_NOTICE_MS', 30_000)
/** A message waited this long with no session to take it: tell the owner. */
export const UNCLAIMED_NOTICE_MS = ms('TG_UNCLAIMED_NOTICE_MS', 60_000)
/** A session took a message and sent nothing back for this long: tell the owner. */
export const STALL_NOTICE_MS = ms('TG_STALL_NOTICE_MS', 10 * 60_000)
export const HEARTBEAT_MS = ms('TG_HEARTBEAT_MS', 10_000)
export const TICK_MS = ms('TG_TICK_MS', 2_000)
export const POLL_TIMEOUT_S = Number(process.env.TG_POLL_TIMEOUT_S ?? 30)
export const DONE_KEEP_MS = 30 * 24 * 3600_000

/** Everything the gateway sends by itself ends with this signature. */
export const SIGNATURE = process.env.TG_SIGNATURE ?? `- EA ${EA_NAME}`

/** Load KEY=VALUE lines from the bot's .env without overriding real env. */
export function loadEnvFile(): void {
  try {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^(\w+)=(.*)$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  } catch {}
}

/** One queued inbound message, exactly what the session will be shown. */
export type QueueItem = {
  update_id: number
  received_at: string
  content: string
  meta: Record<string, string>
}

/** Client → gateway. One JSON object per line. */
export type Request = { id: number; op: string; [k: string]: unknown }
/** Gateway → client: a reply to a request, or a pushed event. */
export type Reply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { event: 'message'; item: QueueItem }

export type Status = {
  pid: number
  bot: string
  started_at: string
  last_poll_ok: string | null
  queue: number
  channels: number
  down_since: string | null
}

/** The owner's wall clock (TG_TIMEZONE, else the system zone), for notices. */
export const TIMEZONE = process.env.TG_TIMEZONE || undefined
export function localTime(d = new Date()): string {
  return d.toLocaleTimeString('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
}
