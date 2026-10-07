#!/usr/bin/env bun
/**
 * tg-gateway: the one process that talks to Telegram for the assistant.
 *
 * launchd keeps it running (config/launchd/com.<name>.telegram-gateway.plist).
 * It long-polls the bot, applies the same access control the official plugin
 * did, writes every accepted message to a queue file BEFORE moving the
 * Telegram offset, and hands queued messages to whichever assistant session has
 * connected over the unix socket. Sessions send replies back through the
 * same socket, so the bot token never enters a chat session.
 *
 * Fail loudly: it tells the owner on Telegram when the session
 * drops, when a message sits with nobody to take it, and when a session took
 * a message and went silent. bin/tg-watchdog covers the gateway itself.
 *
 * Forked from the official telegram plugin's server.ts (v0.0.7, Apache-2.0):
 * access control, chunking and the outbound tools are that code, moved here.
 * Not carried over: the permission relay and the plugin's pid-file takeover,
 * which is the behaviour that caused the outages this replaces.
 *
 * Design: block G and step 13 of GUIDE.md.
 *
 * Derived from the telegram plugin in anthropics/claude-plugins-official
 * (commit 1e96c6b), licensed Apache-2.0, and modified. See README.md.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Bot, GrammyError, InputFile, type Context } from 'grammy'
import type { ReactionTypeEmoji, Update } from 'grammy/types'
import { randomBytes } from 'crypto'
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'fs'
import { createServer, connect, type Socket } from 'net'
import { extname, join, sep } from 'path'
import {
  ACCESS_FILE, APPROVED_DIR, BOT_DIR, DONE_DIR, DONE_KEEP_MS, DOWN_NOTICE_MS,
  ENV_FILE, GW_DIR, HEARTBEAT, HEARTBEAT_MS, INBOX_DIR, LOG_FILE, OFFSET_FILE,
  POLL_TIMEOUT_S, QUEUE_DIR, SIGNATURE, SOCKET, STALL_NOTICE_MS, TICK_MS,
  UNCLAIMED_NOTICE_MS, localTime, loadEnvFile, EA_NAME, MACHINE, RESUME_CMD,
  type QueueItem, type Reply, type Request, type Status,
} from './common'

loadEnvFile()
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  process.stderr.write(`tg-gateway: TELEGRAM_BOT_TOKEN required, set it in ${ENV_FILE}\n`)
  process.exit(1)
}
try { chmodSync(ENV_FILE, 0o600) } catch {}
// Logs, heartbeat, queue and downloaded attachments are private to the owner.
process.umask(0o077)

const API_ROOT = process.env.TELEGRAM_API_ROOT ?? 'https://api.telegram.org'
for (const d of [BOT_DIR, GW_DIR, QUEUE_DIR, DONE_DIR, INBOX_DIR]) {
  mkdirSync(d, { recursive: true, mode: 0o700 })
  try { chmodSync(d, 0o700) } catch {}
}

/** Download URLs carry the token; keep it out of logs and socket errors. */
const redact = (s: string) => s.replaceAll(TOKEN!, '<token>')

function log(msg: string): void {
  const line = `${new Date().toISOString()} ${redact(msg)}\n`
  try { appendFileSync(LOG_FILE, line) } catch {}
  process.stderr.write(line)
}

/** Disk trouble: the update is not acknowledged, so Telegram sends it again. */
class DiskError extends Error {}

process.on('unhandledRejection', err => log(`unhandled rejection: ${err}`))
process.on('uncaughtException', err => log(`uncaught exception: ${err}`))

const bot = new Bot(TOKEN, { client: { apiRoot: API_ROOT } })
let botUsername = ''
const startedAt = new Date()
let lastPollOk: Date | null = null

// ---------------------------------------------------------------- access --
// Unchanged from the plugin: allowlist, pairing codes, group policy.

type PendingEntry = { senderId: string; chatId: string; createdAt: number; expiresAt: number; replies: number }
type GroupPolicy = { requireMention: boolean; allowFrom: string[] }
type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
  pending: Record<string, PendingEntry>
  mentionPatterns?: string[]
  ackReaction?: string
  replyToMode?: 'off' | 'first' | 'all'
  textChunkLimit?: number
  chunkMode?: 'length' | 'newline'
}

const defaultAccess = (): Access => ({ dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} })

function loadAccess(): Access {
  try {
    const p = JSON.parse(readFileSync(ACCESS_FILE, 'utf8')) as Partial<Access>
    return {
      dmPolicy: p.dmPolicy ?? 'pairing',
      allowFrom: p.allowFrom ?? [],
      groups: p.groups ?? {},
      pending: p.pending ?? {},
      mentionPatterns: p.mentionPatterns,
      ackReaction: p.ackReaction,
      replyToMode: p.replyToMode,
      textChunkLimit: p.textChunkLimit,
      chunkMode: p.chunkMode,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAccess()
    // Only bad JSON is moved aside. A read error (permissions, I/O) must not
    // wipe the allowlist, so it is retried instead.
    if (!(err instanceof SyntaxError)) throw new DiskError(`cannot read access.json: ${err}`)
    try { renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`) } catch {}
    log('access.json is corrupt, moved aside; starting with an empty allowlist')
    return defaultAccess()
  }
}

function saveAccess(a: Access): void {
  mkdirSync(BOT_DIR, { recursive: true, mode: 0o700 })
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, ACCESS_FILE)
}

function pruneExpired(a: Access): boolean {
  let changed = false
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < Date.now()) { delete a.pending[code]; changed = true }
  }
  return changed
}

function assertAllowedChat(chat_id: string): void {
  const access = loadAccess()
  if (access.allowFrom.includes(chat_id) || Object.hasOwn(access.groups, chat_id)) return
  throw new Error(`chat ${chat_id} is not allowlisted`)
}

// The bot's own state (token, access list) must never be sent as a file.
// macOS volumes are usually case-insensitive, so compare paths that way there.
function assertSendable(f: string): void {
  const fold = (p: string) => process.platform === 'darwin' ? p.toLowerCase() : p
  let real: string, stateReal: string
  try { real = fold(realpathSync.native(f)); stateReal = fold(realpathSync.native(BOT_DIR)) } catch (err) {
    throw new Error(`cannot check file ${f}: ${err instanceof Error ? err.message : err}`)
  }
  const inbox = join(stateReal, 'inbox')
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

type GateResult = { action: 'deliver'; access: Access } | { action: 'drop' } | { action: 'pair'; code: string; isResend: boolean }

function gate(ctx: Context): GateResult {
  const access = loadAccess()
  if (pruneExpired(access)) {
    try { saveAccess(access) } catch (err) { log(`could not prune expired pairings: ${err}`) }
  }
  if (access.dmPolicy === 'disabled' || !ctx.from) return { action: 'drop' }
  const senderId = String(ctx.from.id)
  const chatType = ctx.chat?.type

  if (chatType === 'private') {
    if (access.allowFrom.includes(senderId)) return { action: 'deliver', access }
    if (access.dmPolicy === 'allowlist') return { action: 'drop' }
    for (const [code, p] of Object.entries(access.pending)) {
      if (p.senderId === senderId) {
        if ((p.replies ?? 1) >= 2) return { action: 'drop' }
        p.replies = (p.replies ?? 1) + 1
        saveAccess(access)
        return { action: 'pair', code, isResend: true }
      }
    }
    if (Object.keys(access.pending).length >= 3) return { action: 'drop' }
    const code = randomBytes(3).toString('hex')
    const now = Date.now()
    access.pending[code] = { senderId, chatId: String(ctx.chat!.id), createdAt: now, expiresAt: now + 3600_000, replies: 1 }
    saveAccess(access)
    return { action: 'pair', code, isResend: false }
  }

  if (chatType === 'group' || chatType === 'supergroup') {
    const policy = access.groups[String(ctx.chat!.id)]
    if (!policy) return { action: 'drop' }
    const groupAllowFrom = policy.allowFrom ?? []
    if (groupAllowFrom.length > 0 && !groupAllowFrom.includes(senderId)) return { action: 'drop' }
    if ((policy.requireMention ?? true) && !isMentioned(ctx, access.mentionPatterns)) return { action: 'drop' }
    return { action: 'deliver', access }
  }
  return { action: 'drop' }
}

function dmCommandGate(ctx: Context): { access: Access; senderId: string } | null {
  if (ctx.chat?.type !== 'private' || !ctx.from) return null
  const senderId = String(ctx.from.id)
  const access = loadAccess()
  if (pruneExpired(access)) saveAccess(access)
  if (access.dmPolicy === 'disabled') return null
  if (access.dmPolicy === 'allowlist' && !access.allowFrom.includes(senderId)) return null
  return { access, senderId }
}

function isMentioned(ctx: Context, extraPatterns?: string[]): boolean {
  const entities = ctx.message?.entities ?? ctx.message?.caption_entities ?? []
  const text = ctx.message?.text ?? ctx.message?.caption ?? ''
  for (const e of entities) {
    if (e.type === 'mention' && text.slice(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername}`.toLowerCase()) return true
    if (e.type === 'text_mention' && e.user?.is_bot && e.user.username === botUsername) return true
  }
  if (ctx.message?.reply_to_message?.from?.username === botUsername) return true
  for (const pat of extraPatterns ?? []) {
    try { if (new RegExp(pat, 'i').test(text)) return true } catch {}
  }
  return false
}

const approving = new Set<string>()

function checkApprovals(): void {
  let files: string[]
  try { files = readdirSync(APPROVED_DIR) } catch { return }
  for (const senderId of files) {
    if (approving.has(senderId)) continue
    approving.add(senderId)
    const file = join(APPROVED_DIR, senderId)
    void bot.api.sendMessage(senderId, `Paired! Say hi to ${EA_NAME}.`).catch(err => log(`approval confirm failed: ${err}`))
      .finally(() => { rmSync(file, { force: true }); approving.delete(senderId) })
  }
}

// ----------------------------------------------------------------- queue --

function queuePath(id: number): string { return join(QUEUE_DIR, `${id}.json`) }

function enqueue(item: QueueItem): void {
  try {
    const tmp = queuePath(item.update_id) + '.tmp'
    writeFileSync(tmp, JSON.stringify(item, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, queuePath(item.update_id))
  } catch (err) {
    throw new DiskError(`cannot write queue file for update ${item.update_id}: ${err}`)
  }
}

function queued(): QueueItem[] {
  const items: QueueItem[] = []
  for (const f of readdirSync(QUEUE_DIR)) {
    if (!/^\d+\.json$/.test(f)) continue
    try { items.push(JSON.parse(readFileSync(join(QUEUE_DIR, f), 'utf8'))) } catch (err) { log(`unreadable queue file ${f}: ${err}`) }
  }
  return items.sort((a, b) => a.update_id - b.update_id)
}

function markDone(id: number): void {
  try { renameSync(queuePath(id), join(DONE_DIR, `${id}.json`)) } catch {}
}

// An ack only proves the channel process wrote the event; the session may
// still have dropped it (started without channels enabled, say). So an acked
// message stays queued, marked delivered, until the session sends something
// to that chat. If it never does, the next session gets it again.
function markDelivered(id: number): void {
  try {
    const item = JSON.parse(readFileSync(queuePath(id), 'utf8')) as QueueItem
    if (!item.delivered_at) enqueue({ ...item, delivered_at: new Date().toISOString() })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`cannot mark update ${id} delivered: ${err}`)
  }
}

function pruneDone(): void {
  for (const f of readdirSync(DONE_DIR)) {
    const p = join(DONE_DIR, f)
    try { if (Date.now() - statSync(p).mtimeMs > DONE_KEEP_MS) rmSync(p) } catch {}
  }
}

// -------------------------------------------------------------- sessions --
// A "channel" is an assistant session's tg-channel process that said hello with
// role "channel". Only channels are given inbound messages. Anything else on
// the socket (bin/tg-status, a headless run) may send but never receives.

type Client = {
  sock: Socket; role: 'channel' | 'tool'; label: string; inflight: Set<number>
  /** update_id -> when this client acked it. */
  acked: Map<number, number>
  /** When this client's previous reply/react/edit started. */
  lastCall: number
}
const clients = new Set<Client>()
const channels = (): Client[] => [...clients].filter(c => c.role === 'channel')

/** When the last channel went away; null while one is connected or none ever was. */
let downSince: Date | null = null
let downNotified = false
let unclaimedNotified = false
/** Oldest delivery that has had no outbound activity since; drives the stall notice. */
let deliveredUnanswered: Date | null = null
let stallNotified = false

function push(c: Client, msg: Reply): void {
  try { c.sock.write(JSON.stringify(msg) + '\n') } catch {}
}

/** Is the sender of a queued message still allowed in? Access may have changed since it was queued. */
function stillAllowed(a: Access, meta: Record<string, string>): boolean {
  if (a.dmPolicy === 'disabled') return false
  if (meta.chat_id !== meta.user_id) {
    if (!Object.hasOwn(a.groups, meta.chat_id)) return false
    const allow = a.groups[meta.chat_id].allowFrom ?? []
    return allow.length === 0 || allow.includes(meta.user_id)
  }
  return a.allowFrom.includes(meta.user_id)
}

/**
 * Hand every queued message to the newest connected channel, oldest message
 * first. The newest, because an older session that stopped reading would
 * otherwise keep swallowing everything.
 */
function dispatch(): void {
  const primary = channels().at(-1)
  if (!primary) return
  let access: Access
  try { access = loadAccess() } catch (err) { log(`dispatch postponed: ${err}`); return }
  for (const item of queued()) {
    if (primary.inflight.has(item.update_id)) continue
    if (!stillAllowed(access, item.meta)) {
      log(`dropped queued update ${item.update_id}: sender ${item.meta.user_id} is no longer allowed`)
      markDone(item.update_id)
      continue
    }
    primary.inflight.add(item.update_id)
    push(primary, { event: 'message', item: item.delivered_at ? { ...item, meta: { ...item.meta, redelivered: 'true' } } : item })
  }
}

async function notifyOwners(text: string): Promise<void> {
  for (const chat of loadAccess().allowFrom) {
    try { await bot.api.sendMessage(chat, `${text}\n${SIGNATURE}`) } catch (err) { log(`notice to ${chat} failed: ${err}`) }
  }
}

function onChannelConnected(c: Client): void {
  const wasLoud = downNotified || unclaimedNotified
  const waiting = queued().length
  downSince = null
  downNotified = false
  unclaimedNotified = false
  log(`channel connected: ${c.label} (queue ${waiting})`)
  if (wasLoud) {
    void notifyOwners(waiting ? `${EA_NAME} is back. ${waiting} saved message${waiting === 1 ? '' : 's'} delivered now.` : `${EA_NAME} is back.`)
  }
  dispatch()
}

function onClientClosed(c: Client): void {
  clients.delete(c)
  if (c.role !== 'channel') return
  log(`channel disconnected: ${c.label}`)
  if (channels().length === 0) {
    downSince = new Date()
    deliveredUnanswered = null
    stallNotified = false
  } else {
    dispatch() // unacked items go to the next channel
  }
}

/** The fail-loudly rules. Runs every TICK_MS. */
function tick(): void {
  const now = Date.now()
  const noChannel = channels().length === 0

  if (noChannel && downSince && !downNotified && now - downSince.getTime() >= DOWN_NOTICE_MS) {
    downNotified = true
    log('notice: session dropped')
    void notifyOwners(
      `${EA_NAME}'s session dropped at ${localTime(downSince)}. Messages are being saved. ` +
      `To bring ${EA_NAME} back: run ${RESUME_CMD} on ${MACHINE}.`,
    )
  }

  if (noChannel && !unclaimedNotified && !downNotified) {
    const oldest = queued().find(i => !i.delivered_at)
    if (oldest && now - Date.parse(oldest.received_at) >= UNCLAIMED_NOTICE_MS) {
      unclaimedNotified = true
      log('notice: message unclaimed')
      void notifyOwners(`Got it. ${EA_NAME} is not running right now; this is saved and will be delivered at the next start.`)
    }
  }

  if (!noChannel && deliveredUnanswered && !stallNotified && now - deliveredUnanswered.getTime() >= STALL_NOTICE_MS) {
    stallNotified = true
    log('notice: session silent after delivery')
    void notifyOwners(
      `${EA_NAME} was handed your message at ${localTime(deliveredUnanswered)} and has sent nothing back since. ` +
      `The session may be busy on a long task, stuck, or started without the Telegram channel. Check ${MACHINE}.`,
    )
  }
}

function status(): Status {
  return {
    pid: process.pid,
    bot: botUsername,
    started_at: startedAt.toISOString(),
    last_poll_ok: lastPollOk?.toISOString() ?? null,
    queue: queued().length,
    channels: channels().length,
    down_since: downSince?.toISOString() ?? null,
  }
}

function writeHeartbeat(): void {
  try {
    const tmp = HEARTBEAT + '.tmp'
    writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), ...status() }) + '\n')
    renameSync(tmp, HEARTBEAT)
  } catch (err) { log(`heartbeat write failed: ${err}`) }
}

// -------------------------------------------------------------- outbound --

const MAX_CHUNK_LIMIT = 4096
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

function chunk(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    if (mode === 'newline') {
      const para = rest.lastIndexOf('\n\n', limit)
      const line = rest.lastIndexOf('\n', limit)
      const space = rest.lastIndexOf(' ', limit)
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    }
    // Never split an emoji (or any surrogate pair) across two messages.
    const c = rest.charCodeAt(cut - 1)
    if (cut > 1 && c >= 0xd800 && c <= 0xdbff) cut--
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}

async function opSend(a: Record<string, unknown>): Promise<string> {
  const chat_id = String(a.chat_id)
  const text = String(a.text ?? '')
  const reply_to = a.reply_to != null ? Number(a.reply_to) : undefined
  const files = a.files ?? []
  if (!Array.isArray(files) || !files.every(f => typeof f === 'string')) throw new Error('files must be an array of paths')
  if (!text && !files.length) throw new Error('nothing to send: text and files are both empty')
  const parseMode = a.format === 'markdownv2' ? ('MarkdownV2' as const) : undefined
  assertAllowedChat(chat_id)
  for (const f of files) {
    assertSendable(f)
    const st = statSync(f)
    if (st.size > MAX_ATTACHMENT_BYTES) throw new Error(`file too large: ${f} (${(st.size / 1024 / 1024).toFixed(1)}MB, max 50MB)`)
  }
  const access = loadAccess()
  const limit = Math.max(1, Math.min(access.textChunkLimit ?? MAX_CHUNK_LIMIT, MAX_CHUNK_LIMIT))
  const replyMode = access.replyToMode ?? 'first'
  const chunks = text ? chunk(text, limit, access.chunkMode ?? 'length') : []
  const sentIds: number[] = []
  try {
    for (let i = 0; i < chunks.length; i++) {
      const threaded = reply_to != null && replyMode !== 'off' && (replyMode === 'all' || i === 0)
      const sent = await bot.api.sendMessage(chat_id, chunks[i], {
        ...(threaded ? { reply_parameters: { message_id: reply_to } } : {}),
        ...(parseMode ? { parse_mode: parseMode } : {}),
      })
      sentIds.push(sent.message_id)
    }
  } catch (err) {
    throw new Error(`reply failed after ${sentIds.length} of ${chunks.length} chunk(s) sent: ${err instanceof Error ? err.message : err}`)
  }
  for (const f of files) {
    const opts = reply_to != null && replyMode !== 'off' ? { reply_parameters: { message_id: reply_to } } : undefined
    // Telegram caps photos at 10MB; a bigger image still goes, as a document.
    const sent = PHOTO_EXTS.has(extname(f).toLowerCase()) && statSync(f).size <= MAX_PHOTO_BYTES
      ? await bot.api.sendPhoto(chat_id, new InputFile(f), opts)
      : await bot.api.sendDocument(chat_id, new InputFile(f), opts)
    sentIds.push(sent.message_id)
  }
  return sentIds.length === 1 ? `sent (id: ${sentIds[0]})` : `sent ${sentIds.length} parts (ids: ${sentIds.join(', ')})`
}

const DOWNLOAD_TIMEOUT_MS = 120_000

async function downloadFile(file_id: string): Promise<string> {
  // A stalled download would otherwise hold up the poll loop for good.
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  const file = await bot.api.getFile(file_id, signal)
  if (!file.file_path) throw new Error('Telegram returned no file_path, the file may have expired')
  const res = await fetch(`${API_ROOT}/file/bot${TOKEN}/${file.file_path}`, { signal })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const rawExt = file.file_path.includes('.') ? file.file_path.split('.').pop()! : 'bin'
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '') || 'bin'
  const uniqueId = (file.file_unique_id ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || 'dl'
  const path = join(INBOX_DIR, `${Date.now()}-${uniqueId}.${ext}`)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return path
}

async function handleRequest(c: Client, req: Request): Promise<unknown> {
  const a = req as Record<string, unknown>
  const started = Date.now()
  switch (req.op) {
    case 'hello':
      c.role = a.role === 'channel' ? 'channel' : 'tool'
      c.label = String(a.label ?? `pid ${a.pid ?? '?'}`)
      if (c.role === 'channel') onChannelConnected(c)
      return status()
    case 'status':
      return status()
    case 'ack':
      markDelivered(Number(a.update_id))
      c.acked.set(Number(a.update_id), Date.now())
      if (!deliveredUnanswered) deliveredUnanswered = new Date()
      return 'ok'
    case 'send': return answered(c, started, String(a.chat_id), await opSend(a), a.reply_to != null ? Number(a.reply_to) : undefined)
    case 'react':
      assertAllowedChat(String(a.chat_id))
      await bot.api.setMessageReaction(String(a.chat_id), Number(a.message_id), [
        { type: 'emoji', emoji: a.emoji as ReactionTypeEmoji['emoji'] },
      ])
      return answered(c, started, String(a.chat_id), 'reacted', Number(a.message_id))
    case 'edit': {
      assertAllowedChat(String(a.chat_id))
      const edited = await bot.api.editMessageText(
        String(a.chat_id), Number(a.message_id), String(a.text),
        ...(a.format === 'markdownv2' ? [{ parse_mode: 'MarkdownV2' as const }] : []),
      )
      return answered(c, started, String(a.chat_id), `edited (id: ${typeof edited === 'object' ? edited.message_id : a.message_id})`)
    }
    case 'download':
      return await downloadFile(String(a.file_id))
    default:
      throw new Error(`unknown op: ${req.op}`)
  }
}

/**
 * Any outbound message proves the session is alive. A message it was handed
 * leaves the queue only once this session has clearly seen it: it replied to
 * or reacted on that message (or a later one), or it was acked before this
 * session's previous call began. Anything newer stays queued, so a crash
 * mid-task redelivers it. Tool clients (bin/tg-status) never clear anything.
 */
function answered<T>(c: Client, started: number, chat_id: string, result: T, target?: number): T {
  deliveredUnanswered = null
  stallNotified = false
  if (c.role !== 'channel') return result
  const seenBefore = c.lastCall
  c.lastCall = started
  try {
    for (const item of queued()) {
      const at = c.acked.get(item.update_id)
      if (at == null || item.meta.chat_id !== chat_id) continue
      if (at < seenBefore || (target != null && Number(item.meta.message_id) <= target)) {
        markDone(item.update_id)
        c.acked.delete(item.update_id)
      }
    }
  } catch (err) { log(`cannot clear answered messages: ${err}`) }
  return result
}

// ---------------------------------------------------------------- socket --

function serve(): void {
  const server = createServer(sock => {
    const c: Client = { sock, role: 'tool', label: 'unnamed', inflight: new Set(), acked: new Map(), lastCall: 0 }
    clients.add(c)
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let req: Request
        try { req = JSON.parse(line) } catch { continue }
        if (!req || typeof req !== 'object') continue
        handleRequest(c, req).then(
          result => push(c, { id: req.id, ok: true, result }),
          err => push(c, { id: req.id, ok: false, error: redact(err instanceof Error ? err.message : String(err)) }),
        )
      }
    })
    sock.on('close', () => onClientClosed(c))
    sock.on('error', () => {})
  })
  server.listen(SOCKET, () => { try { chmodSync(SOCKET, 0o600) } catch {} })
  server.on('error', err => { log(`socket error: ${err}`); process.exit(1) })
}

/** Refuse to start beside a live gateway; clear a socket file left by a dead one. */
async function claimSocket(): Promise<void> {
  if (!existsSync(SOCKET)) return
  const alive = await new Promise<boolean>(resolve => {
    const s = connect(SOCKET)
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
  })
  if (alive) { log('another gateway already owns the socket; exiting'); process.exit(0) }
  rmSync(SOCKET, { force: true })
}

// --------------------------------------------------------------- inbound --

type AttachmentMeta = { kind: string; file_id: string; size?: number; mime?: string; name?: string }

// Uploader-controlled names land inside the <channel> tag; strip delimiters.
const safeName = (s: string | undefined) => s?.replace(/[<>\[\]\r\n;]/g, '_')

async function handleInbound(ctx: Context, text: string, photoFileId?: string, attachment?: AttachmentMeta): Promise<void> {
  const result = gate(ctx)
  if (result.action === 'drop') return
  if (result.action === 'pair') {
    await ctx.reply(`${result.isResend ? 'Still pending' : 'Pairing required'}. Ask the owner to approve code ${result.code} in ${EA_NAME}'s session.`)
    return
  }
  const from = ctx.from!
  const chat_id = String(ctx.chat!.id)
  const msgId = ctx.message?.message_id

  if (channels().length > 0) void bot.api.sendChatAction(chat_id, 'typing').catch(() => {})
  if (result.access.ackReaction && msgId != null) {
    void bot.api.setMessageReaction(chat_id, msgId, [
      { type: 'emoji', emoji: result.access.ackReaction as ReactionTypeEmoji['emoji'] },
    ]).catch(() => {})
  }

  // Fetch files now, while Telegram still has them. A failed download is
  // not a reason to lose the message: the file_id stays in meta for a retry.
  let imagePath: string | undefined
  let attachmentPath: string | undefined
  try { if (photoFileId) imagePath = await downloadFile(photoFileId) } catch (err) { log(`photo download failed: ${err}`) }
  try {
    if (attachment && (attachment.size ?? 0) <= 20 * 1024 * 1024) attachmentPath = await downloadFile(attachment.file_id)
  } catch (err) { log(`attachment download failed: ${err}`) }

  enqueue({
    update_id: ctx.update.update_id,
    received_at: new Date().toISOString(),
    content: text,
    meta: {
      chat_id,
      ...(msgId != null ? { message_id: String(msgId) } : {}),
      user: from.username ?? String(from.id),
      user_id: String(from.id),
      ts: new Date((ctx.message?.date ?? 0) * 1000).toISOString(),
      ...(imagePath ? { image_path: imagePath } : {}),
      ...(photoFileId && !imagePath ? { attachment_kind: 'photo', attachment_file_id: photoFileId } : {}),
      ...(attachment ? {
        attachment_kind: attachment.kind,
        attachment_file_id: attachment.file_id,
        ...(attachment.size != null ? { attachment_size: String(attachment.size) } : {}),
        ...(attachment.mime ? { attachment_mime: attachment.mime } : {}),
        ...(attachment.name ? { attachment_name: attachment.name } : {}),
        ...(attachmentPath ? { attachment_path: attachmentPath } : {}),
      } : {}),
    },
  })
  log(`queued update ${ctx.update.update_id} from ${from.id}${attachment ? ` (${attachment.kind})` : ''}`)
  dispatch()
}

bot.command('start', async ctx => {
  if (!dmCommandGate(ctx)) return
  await ctx.reply(`This bot is the line to ${EA_NAME}, a personal assistant. Messages from people the owner has approved reach it; others are ignored.`)
})
bot.command('help', async ctx => {
  if (!dmCommandGate(ctx)) return
  await ctx.reply(`Send text, voice notes, photos or files. /status shows whether ${EA_NAME} is running.`)
})
bot.command('status', async ctx => {
  const gated = dmCommandGate(ctx)
  if (!gated) return
  if (!gated.access.allowFrom.includes(gated.senderId)) { await ctx.reply('Not paired.'); return }
  const s = status()
  await ctx.reply(
    `Gateway up since ${localTime(startedAt)}. ` +
    (s.channels ? `${EA_NAME} is connected.` : `${EA_NAME} is NOT connected${downSince ? ` (since ${localTime(downSince)})` : ''}.`) +
    ` ${s.queue} message${s.queue === 1 ? '' : 's'} waiting.\n${SIGNATURE}`,
  )
})

bot.on('message:text', ctx => handleInbound(ctx, ctx.message.text))
bot.on('message:photo', ctx => {
  const photos = ctx.message.photo
  return handleInbound(ctx, ctx.message.caption ?? '(photo)', photos[photos.length - 1].file_id)
})
bot.on('message:document', ctx => {
  const doc = ctx.message.document
  const name = safeName(doc.file_name)
  return handleInbound(ctx, ctx.message.caption ?? `(document: ${name ?? 'file'})`, undefined,
    { kind: 'document', file_id: doc.file_id, size: doc.file_size, mime: doc.mime_type, name })
})
bot.on('message:voice', ctx => {
  const v = ctx.message.voice
  return handleInbound(ctx, ctx.message.caption ?? '(voice message)', undefined,
    { kind: 'voice', file_id: v.file_id, size: v.file_size, mime: v.mime_type })
})
bot.on('message:audio', ctx => {
  const a = ctx.message.audio
  const name = safeName(a.file_name)
  return handleInbound(ctx, ctx.message.caption ?? `(audio: ${safeName(a.title) ?? name ?? 'audio'})`, undefined,
    { kind: 'audio', file_id: a.file_id, size: a.file_size, mime: a.mime_type, name })
})
bot.on('message:video', ctx => {
  const v = ctx.message.video
  return handleInbound(ctx, ctx.message.caption ?? '(video)', undefined,
    { kind: 'video', file_id: v.file_id, size: v.file_size, mime: v.mime_type, name: safeName(v.file_name) })
})
bot.on('message:video_note', ctx => {
  const vn = ctx.message.video_note
  return handleInbound(ctx, '(video note)', undefined, { kind: 'video_note', file_id: vn.file_id, size: vn.file_size })
})
bot.on('message:sticker', ctx => {
  const s = ctx.message.sticker
  return handleInbound(ctx, `(sticker${s.emoji ? ` ${s.emoji}` : ''})`, undefined,
    { kind: 'sticker', file_id: s.file_id, size: s.file_size })
})

// ------------------------------------------------------------------ poll --
// Own loop instead of bot.start(): the offset only moves after the handler
// returned, and a message that could not be written to disk is asked for
// again instead of being acknowledged and lost.

function loadOffset(): number | undefined {
  try { const n = parseInt(readFileSync(OFFSET_FILE, 'utf8'), 10); return Number.isFinite(n) ? n : undefined } catch { return undefined }
}
function saveOffset(n: number): void {
  const tmp = OFFSET_FILE + '.tmp'
  writeFileSync(tmp, String(n))
  renameSync(tmp, OFFSET_FILE)
}

let shuttingDown = false

async function poll(): Promise<void> {
  let offset = loadOffset()
  let failures = 0
  while (!shuttingDown) {
    let updates: Update[]
    try {
      updates = await bot.api.getUpdates({ offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] })
      lastPollOk = new Date()
      failures = 0
    } catch (err) {
      if (shuttingDown) return
      failures++
      const is409 = err instanceof GrammyError && err.error_code === 409
      log(is409
        ? 'poll: 409 Conflict, something else is polling this bot (the old plugin, or a second gateway)'
        : `poll error: ${err}`)
      await new Promise(r => setTimeout(r, Math.min(1000 * failures, 15_000)))
      continue
    }
    for (const u of updates) {
      try {
        await bot.handleUpdate(u)
      } catch (err) {
        const cause = (err as { error?: unknown }).error ?? err
        if (cause instanceof DiskError) {
          log(`${cause.message}; not acknowledging, will ask Telegram again`)
          await new Promise(r => setTimeout(r, 5000))
          break
        }
        log(`handler error on update ${u.update_id} (skipped): ${cause}`)
      }
      offset = u.update_id + 1
      try { saveOffset(offset) } catch (err) { log(`cannot save offset ${offset}: ${err}`) }
    }
  }
}

function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  log('shutting down')
  try { rmSync(SOCKET, { force: true }) } catch {}
  setTimeout(() => process.exit(0), 500)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await claimSocket()
for (let attempt = 1; ; attempt++) {
  try { await bot.init(); break } catch (err) {
    log(`cannot reach Telegram (getMe): ${err}`)
    await new Promise(r => setTimeout(r, Math.min(2000 * attempt, 30_000)))
  }
}
botUsername = bot.botInfo.username
serve()
log(`gateway started as @${botUsername}, pid ${process.pid}, queue ${queued().length}`)
void bot.api.setMyCommands(
  [
    { command: 'status', description: `Is ${EA_NAME} running?` },
    { command: 'help', description: 'What this bot does' },
  ],
  { scope: { type: 'all_private_chats' } },
).catch(() => {})

writeHeartbeat()
setInterval(writeHeartbeat, HEARTBEAT_MS)
setInterval(tick, TICK_MS)
setInterval(checkApprovals, 5000)
setInterval(pruneDone, 6 * 3600_000)
await poll()
