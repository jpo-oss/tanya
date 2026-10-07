/**
 * End-to-end tests for the gateway and the channel server.
 *
 * Nothing here touches the real bot. Each test starts its own gateway
 * process pointed (TELEGRAM_API_ROOT) at a fake Telegram served on
 * localhost, with its queue and bot state in a temp folder, and thresholds
 * shortened to a second or two. Run with `bun test` in this folder.
 *
 * Derived from the telegram plugin in anthropics/claude-plugins-official
 * (commit 1e96c6b), licensed Apache-2.0, and modified. See README.md.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'

const HERE = import.meta.dir
const OWNER = 111
const STRANGER = 999
const TOKEN = '1:fake'

type Call = { method: string; body: any }

/** A stand-in for api.telegram.org that records what the gateway sends. */
function fakeTelegram() {
  const calls: Call[] = []
  const updates: any[] = []
  let nextUpdate = 1000
  let nextMessage = 1
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.startsWith(`/file/bot${TOKEN}/`)) return new Response('voice-bytes')
      const method = url.pathname.split('/').pop()!
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
      calls.push({ method, body })
      const ok = (result: unknown) => Response.json({ ok: true, result })
      switch (method) {
        case 'getMe':
          return ok({ id: 1, is_bot: true, first_name: 'Fake', username: 'fake_bot' })
        case 'getUpdates': {
          const offset = body.offset ?? 0
          for (let i = 0; i < 6; i++) {
            const due = updates.filter(u => u.update_id >= offset)
            if (due.length) return ok(due)
            await Bun.sleep(50)
          }
          return ok([])
        }
        case 'sendMessage':
          return ok({ message_id: nextMessage++, date: 0, chat: { id: body.chat_id, type: 'private' }, text: body.text })
        case 'sendPhoto':
        case 'sendDocument':
          return ok({ message_id: nextMessage++, date: 0, chat: { id: OWNER, type: 'private' } })
        case 'getFile':
          if (body.file_id === 'GONE') return Response.json({ ok: false, error_code: 400, description: 'Bad Request: file is gone' }, { status: 400 })
          return ok({ file_id: body.file_id, file_unique_id: 'uniq', file_path: 'voice/file_1.oga' })
        default:
          return ok(true)
      }
    },
  })
  return {
    url: `http://localhost:${server.port}`,
    calls,
    stop: () => server.stop(true),
    /** Text of every sendMessage so far. */
    sent: () => calls.filter(c => c.method === 'sendMessage').map(c => String(c.body.text)),
    offsets: () => calls.filter(c => c.method === 'getUpdates').map(c => c.body.offset),
    /** Queue an inbound Telegram message; returns its update_id. */
    inbound(text: string, from = OWNER, extra: Record<string, unknown> = {}): number {
      const update_id = nextUpdate++
      updates.push({
        update_id,
        message: {
          message_id: update_id - 900,
          date: Math.floor(Date.now() / 1000),
          chat: { id: from, type: 'private' },
          from: { id: from, is_bot: false, first_name: 'T', username: from === OWNER ? 'owner' : 'stranger' },
          ...(extra.voice || extra.photo ? {} : { text }),
          ...extra,
        },
      })
      return update_id
    },
  }
}

/** A raw socket client, standing in for a Tanya session's channel process. */
function sessionClient(sockPath: string, role: 'channel' | 'tool' = 'channel') {
  const events: any[] = []
  const replies = new Map<number, any>()
  let id = 1
  let buf = ''
  let sock: Socket
  const ready = new Promise<void>((resolve, reject) => {
    sock = connect(sockPath)
    sock.on('connect', resolve)
    sock.on('error', reject)
    sock.setEncoding('utf8')
    sock.on('data', (d: string) => {
      buf += d
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
        if (msg.event) events.push(msg.item); else replies.set(msg.id, msg)
      }
    })
  })
  async function request(op: string, args: Record<string, unknown> = {}) {
    const my = id++
    sock.write(JSON.stringify({ id: my, op, ...args }) + '\n')
    await until(() => replies.has(my))
    return replies.get(my)
  }
  return {
    events,
    request,
    replies,
    write: (b: Buffer) => sock.write(b),
    hello: async () => { await ready; return request('hello', { role, label: 'test' }) },
    close: () => sock.destroy(),
  }
}

async function until(cond: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(25)
  }
}

type Rig = Awaited<ReturnType<typeof rig>>
const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

async function rig(env: Record<string, string> = {}) {
  const tg = fakeTelegram()
  const dir = mkdtempSync(join(tmpdir(), 'tgw-'))
  const botDir = join(dir, 'bot')
  const gwDir = join(dir, 'gw')
  mkdirSync(botDir)
  writeFileSync(join(botDir, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\n`)
  writeFileSync(join(botDir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], groups: {}, pending: {} }))
  const fullEnv = {
    ...process.env,
    ASSISTANT_NAME: 'Tanya',
    TG_MACHINE_LABEL: 'the Mac',
    TELEGRAM_API_ROOT: tg.url,
    TELEGRAM_STATE_DIR: botDir,
    TG_GATEWAY_DIR: gwDir,
    TG_TICK_MS: '100',
    TG_HEARTBEAT_MS: '200',
    TG_DOWN_NOTICE_MS: '600000',
    TG_UNCLAIMED_NOTICE_MS: '600000',
    TG_STALL_NOTICE_MS: '600000',
    ...env,
  }
  let proc: ReturnType<typeof Bun.spawn>
  const sock = join(gwDir, 'gw.sock')
  async function start() {
    proc = Bun.spawn(['bun', join(HERE, 'gateway.ts')], { env: fullEnv, stdout: 'ignore', stderr: 'ignore' })
    await until(() => existsSync(sock), 8000, 'gateway socket')
  }
  async function stop() {
    proc.kill('SIGTERM')
    await proc.exited
  }
  await start()
  cleanup.push(() => { try { proc.kill('SIGKILL') } catch {}; tg.stop(); chmodSync(join(gwDir, 'queue'), 0o700); rmSync(dir, { recursive: true, force: true }) })
  const queue = () => readdirSync(join(gwDir, 'queue')).filter(f => f.endsWith('.json'))
  const done = () => readdirSync(join(gwDir, 'queue/done'))
  return { tg, sock, gwDir, botDir, fullEnv, queue, done, start, stop }
}

describe('queue', () => {
  test('a message with no session is saved to disk, delivered, and removed once its chat is answered', async () => {
    const r = await rig()
    const id = r.tg.inbound('hello Tanya')
    await until(() => r.queue().length === 1, 8000, 'queue file')
    const saved = JSON.parse(readFileSync(join(r.gwDir, 'queue', `${id}.json`), 'utf8'))
    expect(saved.content).toBe('hello Tanya')
    expect(saved.meta.chat_id).toBe(String(OWNER))

    const s = sessionClient(r.sock)
    await s.hello()
    await until(() => s.events.length === 1, 8000, 'delivery')
    expect(s.events[0].content).toBe('hello Tanya')
    expect(r.queue().length).toBe(1) // still held until acknowledged

    await s.request('ack', { update_id: id })
    expect(r.queue().length).toBe(1) // acked, but the session may still have dropped it
    await s.request('send', { chat_id: String(OWNER), text: 'working on it' })
    expect(r.queue().length).toBe(1) // acked while that call was being written: maybe not seen yet
    await s.request('send', { chat_id: String(OWNER), text: 'done' })
    expect(r.queue().length).toBe(0)
    expect(r.done()).toEqual([`${id}.json`])
    s.close()
  })

  test('answering A leaves B, delivered alongside it, queued; the CLI clears nothing', async () => {
    const r = await rig()
    const s = sessionClient(r.sock)
    await s.hello()
    const a = r.tg.inbound('A')
    const b = r.tg.inbound('B')
    await until(() => s.events.length === 2)
    await s.request('ack', { update_id: a })
    await s.request('ack', { update_id: b })

    const cli = sessionClient(r.sock, 'tool')
    await cli.hello()
    await cli.request('send', { chat_id: String(OWNER), text: 'from the terminal' })
    await cli.request('send', { chat_id: String(OWNER), text: 'again' })
    expect(r.queue().length).toBe(2)

    await s.request('send', { chat_id: String(OWNER), text: 'about A', reply_to: s.events[0].meta.message_id })
    expect(r.queue()).toEqual([`${b}.json`])
    s.close(); cli.close()

    const next = sessionClient(r.sock)
    await next.hello()
    await until(() => next.events.length === 1, 8000, 'B redelivered')
    expect(next.events[0].update_id).toBe(b)
    expect(next.events[0].meta.redelivered).toBe('true')
    next.close()
  })

  test('a queued group message is dropped once the group is removed, even from a DM-allowed sender', async () => {
    const r = await rig()
    const group = { requireMention: false, allowFrom: [] }
    writeFileSync(join(r.botDir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], groups: { '-5': group }, pending: {} }))
    const id = r.tg.inbound('in the group', OWNER, { chat: { id: -5, type: 'group' } })
    await until(() => r.queue().length === 1)
    writeFileSync(join(r.botDir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], groups: {}, pending: {} }))
    const s = sessionClient(r.sock)
    await s.hello()
    await Bun.sleep(300)
    expect(s.events).toEqual([])
    expect(r.done()).toEqual([`${id}.json`])
    s.close()
  })

  test('a message acked but never answered goes to the next session, marked as redelivered', async () => {
    const r = await rig()
    const a = sessionClient(r.sock)
    await a.hello()
    const id = r.tg.inbound('did you see this')
    await until(() => a.events.length === 1)
    await a.request('ack', { update_id: id })
    expect(a.events[0].meta.redelivered).toBeUndefined()
    a.close()

    const b = sessionClient(r.sock)
    await b.hello()
    await until(() => b.events.length === 1, 8000, 'redelivery')
    expect(b.events[0].update_id).toBe(id)
    expect(b.events[0].meta.redelivered).toBe('true')
    await b.request('ack', { update_id: id })
    await b.request('react', { chat_id: String(OWNER), message_id: b.events[0].meta.message_id, emoji: '\u{1F440}' })
    expect(r.queue()).toEqual([])
    b.close()
  })

  test('a message from someone not on the allowlist is dropped', async () => {
    const r = await rig()
    r.tg.inbound('let me in', STRANGER)
    const id = r.tg.inbound('real one')
    await until(() => r.queue().length === 1)
    expect(r.queue()).toEqual([`${id}.json`])
    expect(r.tg.sent()).toEqual([])
  })

  test('an unacknowledged message goes to the next session', async () => {
    const r = await rig()
    const a = sessionClient(r.sock)
    await a.hello()
    r.tg.inbound('first try')
    await until(() => a.events.length === 1)
    a.close() // died before acknowledging

    const b = sessionClient(r.sock)
    await b.hello()
    await until(() => b.events.length === 1, 8000, 'redelivery')
    expect(b.events[0].content).toBe('first try')
    b.close()
  })

  test('the queue and the Telegram offset survive a gateway restart', async () => {
    const r = await rig()
    const id = r.tg.inbound('before restart')
    await until(() => r.queue().length === 1)
    await until(() => existsSync(join(r.gwDir, 'offset')))
    await r.stop()
    await r.start()

    const s = sessionClient(r.sock)
    await s.hello()
    await until(() => s.events.length === 1)
    expect(s.events[0].update_id).toBe(id)
    await Bun.sleep(400)
    expect(s.events.length).toBe(1) // not fetched from Telegram a second time
    expect(r.tg.offsets().at(-1)).toBe(id + 1)
    s.close()
  })

  test('if the queue cannot be written, Telegram is asked again instead of losing the message', async () => {
    const r = await rig()
    chmodSync(join(r.gwDir, 'queue'), 0o500)
    const id = r.tg.inbound('do not lose me')
    await until(() => r.tg.offsets().filter(o => o === undefined || o <= id).length >= 2, 12000, 'a re-ask')
    expect(existsSync(join(r.gwDir, 'offset'))).toBe(false)
    chmodSync(join(r.gwDir, 'queue'), 0o700)
    await until(() => r.queue().length === 1, 12000, 'queue file after the disk recovered')
  }, 30000)

  test('a voice note is downloaded when it arrives and its path is in the message', async () => {
    const r = await rig()
    r.tg.inbound('', OWNER, { voice: { file_id: 'F1', file_unique_id: 'u', duration: 3, mime_type: 'audio/ogg', file_size: 11 } })
    const s = sessionClient(r.sock)
    await s.hello()
    await until(() => s.events.length === 1)
    const meta = s.events[0].meta
    expect(meta.attachment_kind).toBe('voice')
    expect(readFileSync(meta.attachment_path, 'utf8')).toBe('voice-bytes')
    expect(statSync(meta.attachment_path).mode & 0o777).toBe(0o600)
    for (const k of Object.keys(meta)) expect(k).toMatch(/^[a-z_]+$/)
    s.close()
  })

  test('a photo that fails to download keeps its file_id for a retry', async () => {
    const r = await rig()
    r.tg.inbound('', OWNER, { caption: 'look', photo: [{ file_id: 'GONE', file_unique_id: 'g', width: 1, height: 1 }] })
    const s = sessionClient(r.sock)
    await s.hello()
    await until(() => s.events.length === 1)
    const meta = s.events[0].meta
    expect(meta.image_path).toBeUndefined()
    expect(meta.attachment_kind).toBe('photo')
    expect(meta.attachment_file_id).toBe('GONE')
    s.close()
  })

  test('a queued message from someone removed from the allowlist is not handed over', async () => {
    const r = await rig()
    const id = r.tg.inbound('sent before removal')
    await until(() => r.queue().length === 1)
    writeFileSync(join(r.botDir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [], groups: {}, pending: {} }))
    const s = sessionClient(r.sock)
    await s.hello()
    await Bun.sleep(300)
    expect(s.events).toEqual([])
    expect(r.queue()).toEqual([])
    expect(r.done()).toEqual([`${id}.json`])
    s.close()
  })

  test('with two sessions connected, the newest one gets the messages', async () => {
    const r = await rig()
    const old = sessionClient(r.sock)
    await old.hello()
    const fresh = sessionClient(r.sock)
    await fresh.hello()
    r.tg.inbound('for the new one')
    await until(() => fresh.events.length === 1)
    expect(old.events).toEqual([])
    old.close(); fresh.close()
  })
})

describe('sending', () => {
  test('a session sends through the gateway; a chat off the allowlist is refused', async () => {
    const r = await rig()
    const s = sessionClient(r.sock)
    await s.hello()
    const ok = await s.request('send', { chat_id: String(OWNER), text: 'hi owner' })
    expect(ok.result).toBe('sent (id: 1)')
    expect(r.tg.sent()).toEqual(['hi owner'])

    const bad = await s.request('send', { chat_id: String(STRANGER), text: 'leak' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('not allowlisted')
    expect(r.tg.sent()).toEqual(['hi owner'])
    s.close()
  })

  test('bot state files cannot be sent as attachments', async () => {
    const r = await rig()
    const s = sessionClient(r.sock)
    await s.hello()
    const bad = await s.request('send', { chat_id: String(OWNER), text: 'x', files: [join(r.botDir, 'access.json')] })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('refusing to send channel state')
    s.close()
  })

  test('the state folder is refused under any letter case on macOS, and a missing file fails closed', async () => {
    const r = await rig()
    const s = sessionClient(r.sock)
    await s.hello()
    const upper = join(r.botDir, '..', 'BOT', '.env')
    const bad = await s.request('send', { chat_id: String(OWNER), text: 'x', files: [upper] })
    expect(bad.ok).toBe(false)
    if (process.platform === 'darwin') expect(bad.error).toContain('refusing to send channel state')
    const missing = await s.request('send', { chat_id: String(OWNER), text: 'x', files: [join(r.gwDir, 'nope.txt')] })
    expect(missing.ok).toBe(false)
    expect(r.tg.sent()).toEqual([])
    s.close()
  })

  test('a reply with only a file and no text sends the file', async () => {
    const r = await rig()
    const s = sessionClient(r.sock)
    await s.hello()
    const f = join(r.gwDir, 'report.txt')
    writeFileSync(f, 'contents')
    const res = await s.request('send', { chat_id: String(OWNER), files: [f] })
    expect(res.ok).toBe(true)
    expect(r.tg.calls.map(c => c.method)).toContain('sendDocument')
    expect(r.tg.sent()).toEqual([])
    const empty = await s.request('send', { chat_id: String(OWNER), text: '' })
    expect(empty.ok).toBe(false)
    const notArray = await s.request('send', { chat_id: String(OWNER), text: 'x', files: f })
    expect(notArray.ok).toBe(false)

    const big = join(r.gwDir, 'big.png')
    writeFileSync(big, Buffer.alloc(11 * 1024 * 1024))
    expect((await s.request('send', { chat_id: String(OWNER), text: '', files: [big] })).ok).toBe(true)
    expect(r.tg.calls.map(c => c.method).filter(m => m === 'sendDocument').length).toBe(2)
    expect(r.tg.calls.some(c => c.method === 'sendPhoto')).toBe(false)
    s.close()
  })

  test('long replies are split without breaking an emoji in two', async () => {
    const r = await rig()
    writeFileSync(join(r.botDir, 'access.json'), JSON.stringify({ dmPolicy: 'allowlist', allowFrom: [String(OWNER)], groups: {}, pending: {}, textChunkLimit: 5 }))
    const s = sessionClient(r.sock)
    await s.hello()
    const res = await s.request('send', { chat_id: String(OWNER), text: 'abcd\u{1F600}efg' })
    expect(res.ok).toBe(true)
    expect(r.tg.sent()).toEqual(['abcd', '\u{1F600}efg'])
    s.close()
  })

  test('a request split inside a multi-byte character arrives intact', async () => {
    const r = await rig()
    const s = sessionClient(r.sock)
    await s.hello()
    const text = 'caf\u00e9 \u{1F600} done'
    const bytes = Buffer.from(JSON.stringify({ id: 99, op: 'send', chat_id: String(OWNER), text }) + '\n')
    const mid = bytes.indexOf(Buffer.from('\u{1F600}')) + 2
    s.write(bytes.subarray(0, mid))
    await Bun.sleep(100)
    s.write(bytes.subarray(mid))
    await until(() => s.replies.has(99))
    expect(r.tg.sent()).toEqual([text])
    s.write(Buffer.from('null\n'))
    expect((await s.request('status')).ok).toBe(true) // still serving
    s.close()
  })

  test('a status-only client is never handed messages', async () => {
    const r = await rig()
    const t = sessionClient(r.sock, 'tool')
    const hello = await t.hello()
    expect(hello.result.channels).toBe(0)
    r.tg.inbound('for Tanya only')
    await until(() => r.queue().length === 1)
    await Bun.sleep(300)
    expect(t.events.length).toBe(0)
    t.close()
  })
})

describe('fail loudly', () => {
  test('a message nobody takes gets the "saved" reply once, then "Tanya is back" on connect', async () => {
    const r = await rig({ TG_UNCLAIMED_NOTICE_MS: '500' })
    r.tg.inbound('anyone there')
    await until(() => r.tg.sent().length === 1, 8000, 'unclaimed notice')
    expect(r.tg.sent()[0]).toBe('Got it. Tanya is not running right now; this is saved and will be delivered at the next start.\n- EA Tanya')
    r.tg.inbound('and another')
    await Bun.sleep(1000)
    expect(r.tg.sent().length).toBe(1) // said once, not per message

    const s = sessionClient(r.sock)
    await s.hello()
    await until(() => r.tg.sent().length === 2, 8000, 'back notice')
    expect(r.tg.sent()[1]).toBe('Tanya is back. 2 saved messages delivered now.\n- EA Tanya')
    s.close()
  })

  test('a dropped session is announced after the grace period, and its return too', async () => {
    const r = await rig({ TG_DOWN_NOTICE_MS: '500' })
    const s = sessionClient(r.sock)
    await s.hello()
    s.close()
    await until(() => r.tg.sent().length === 1, 8000, 'drop notice')
    expect(r.tg.sent()[0]).toMatch(/^Tanya's session dropped at \d\d:\d\d\. Messages are being saved\. To bring Tanya back: run tanya-resume on the Mac\.\n- EA Tanya$/)

    const again = sessionClient(r.sock)
    await again.hello()
    await until(() => r.tg.sent().length === 2, 8000, 'back notice')
    expect(r.tg.sent()[1]).toBe('Tanya is back.\n- EA Tanya')
    again.close()
  })

  test('a quick restart inside the grace period says nothing', async () => {
    const r = await rig({ TG_DOWN_NOTICE_MS: '1500' })
    const s = sessionClient(r.sock)
    await s.hello()
    s.close()
    await Bun.sleep(300)
    const again = sessionClient(r.sock)
    await again.hello()
    await Bun.sleep(1800)
    expect(r.tg.sent()).toEqual([])
    again.close()
  })

  test('no notice before any session has ever connected and no message is waiting', async () => {
    const r = await rig({ TG_DOWN_NOTICE_MS: '300', TG_UNCLAIMED_NOTICE_MS: '300' })
    await Bun.sleep(1000)
    expect(r.tg.sent()).toEqual([])
  })

  test('a session that takes a message and stays silent is reported; one that answers is not', async () => {
    const r = await rig({ TG_STALL_NOTICE_MS: '700' })
    const s = sessionClient(r.sock)
    await s.hello()
    const a = r.tg.inbound('question one')
    await until(() => s.events.length === 1)
    await s.request('ack', { update_id: a })
    await s.request('send', { chat_id: String(OWNER), text: 'answer one' })
    await Bun.sleep(1200)
    expect(r.tg.sent()).toEqual(['answer one'])

    const b = r.tg.inbound('question two')
    await until(() => s.events.length === 2)
    await s.request('ack', { update_id: b })
    await until(() => r.tg.sent().length === 2, 8000, 'stall notice')
    expect(r.tg.sent()[1]).toContain('has sent nothing back since')
    await Bun.sleep(1000)
    expect(r.tg.sent().length).toBe(2)
    s.close()
  })

  test('the heartbeat file is kept fresh and bin/tg-status agrees', async () => {
    const r = await rig()
    await until(() => existsSync(join(r.gwDir, 'heartbeat.json')))
    const hb = JSON.parse(readFileSync(join(r.gwDir, 'heartbeat.json'), 'utf8'))
    expect(hb.bot).toBe('fake_bot')
    await until(() => r.tg.offsets().length >= 2)
    const cli = Bun.spawnSync(['bun', join(HERE, 'cli.ts'), 'json'], { env: r.fullEnv })
    const status = JSON.parse(cli.stdout.toString())
    expect(status.healthy).toBe(true)
    expect(cli.exitCode).toBe(0)

    await r.stop()
    const down = Bun.spawnSync(['bun', join(HERE, 'cli.ts'), 'json'], { env: r.fullEnv })
    expect(JSON.parse(down.stdout.toString()).gateway).toBe('down')
    expect(down.exitCode).toBe(1)
  })

  test('a second gateway refuses to start beside a live one', async () => {
    const r = await rig()
    const second = Bun.spawn(['bun', join(HERE, 'gateway.ts')], { env: r.fullEnv, stdout: 'ignore', stderr: 'ignore' })
    expect(await second.exited).toBe(0)
    const s = sessionClient(r.sock)
    expect((await s.hello()).ok).toBe(true) // the first one still owns the socket
    s.close()
  })
})

describe('channel server (what Claude Code loads)', () => {
  async function mcpSession(r: Rig) {
    const got: any[] = []
    const client = new Client({ name: 'test', version: '0' }, { capabilities: {} })
    client.fallbackNotificationHandler = async n => { got.push(n) }
    await client.connect(new StdioClientTransport({
      command: 'bun', args: [join(HERE, 'channel.ts')], env: r.fullEnv as Record<string, string>, stderr: 'ignore',
    }))
    cleanup.push(() => void client.close())
    return { client, got }
  }

  test('declares the channel capability and the four tools, and holds no token', async () => {
    const r = await rig()
    const { client } = await mcpSession(r)
    expect(client.getServerCapabilities()?.experimental?.['claude/channel']).toEqual({})
    const names = (await client.listTools()).tools.map(t => t.name)
    expect(names).toEqual(['reply', 'react', 'download_attachment', 'edit_message'])
    const src = readFileSync(join(HERE, 'channel.ts'), 'utf8') + readFileSync(join(HERE, 'client.ts'), 'utf8')
    expect(src).not.toContain('TELEGRAM_BOT_TOKEN')
  })

  test('backlog and live messages arrive as channel events, replies go out, closing it drops the session', async () => {
    const r = await rig({ TG_DOWN_NOTICE_MS: '500' })
    r.tg.inbound('sent while down')
    await until(() => r.queue().length === 1)

    const { client, got } = await mcpSession(r)
    await until(() => got.length === 1, 8000, 'backlog event')
    expect(got[0].method).toBe('notifications/claude/channel')
    expect(got[0].params.content).toBe('sent while down')
    expect(got[0].params.meta.chat_id).toBe(String(OWNER))
    await until(() => JSON.parse(readFileSync(join(r.gwDir, 'queue', r.queue()[0]), 'utf8')).delivered_at, 8000, 'ack')

    r.tg.inbound('sent while up')
    await until(() => got.length === 2, 8000, 'live event')

    const res: any = await client.callTool({ name: 'reply', arguments: { chat_id: String(OWNER), text: 'on it' } })
    expect(res.content[0].text).toBe('sent (id: 1)')
    expect(r.tg.sent()).toEqual(['on it'])

    await client.close()
    await until(() => r.tg.sent().length === 2, 8000, 'drop notice after the session closed')
    expect(r.tg.sent()[1]).toContain("Tanya's session dropped")
  })

  test('with the gateway down, a reply fails with a clear error and recovers when it returns', async () => {
    const r = await rig()
    const { client } = await mcpSession(r)
    await until(() => r.tg.calls.some(c => c.method === 'getUpdates'))
    await Bun.sleep(300)
    await r.stop()
    await Bun.sleep(200)
    const res: any = await client.callTool({ name: 'reply', arguments: { chat_id: String(OWNER), text: 'lost?' } })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('gateway is not running')

    await r.start()
    let ok: any
    const end = Date.now() + 8000
    do {
      await Bun.sleep(300)
      ok = await client.callTool({ name: 'reply', arguments: { chat_id: String(OWNER), text: 'back' } })
    } while (ok.isError && Date.now() < end)
    expect(ok.isError).toBeFalsy()
    expect(r.tg.sent()).toEqual(['back'])
  }, 30000)
})

describe('watchdog (bin/tg-watchdog)', () => {
  /** Run the watchdog against a rig, with the text message stubbed to a file. */
  function watchdog(r: Rig) {
    const texts = join(r.gwDir, 'texts.log')
    const stub = join(r.gwDir, 'imsg-stub')
    writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${texts}"\n`, { mode: 0o755 })
    writeFileSync(join(r.gwDir, 'alert-number'), '+10000000000\n')
    // Async spawn: the fake Telegram lives in this process and must stay free to answer.
    const run = () => Bun.spawn(['python3', join(HERE, '../bin/tg-watchdog')], {
      env: {
        ...r.fullEnv,
        TG_WATCHDOG_IMSG: stub,
        TG_WATCHDOG_NO_RESTART: '1',
        TG_ALERT_NUMBER_FILE: join(r.gwDir, 'alert-number'),
      },
      stdout: 'ignore', stderr: 'ignore',
    }).exited
    const sentTexts = () => existsSync(texts) ? readFileSync(texts, 'utf8').trim().split('\n') : []
    return { run, sentTexts }
  }

  test('healthy gateway: silent', async () => {
    const r = await rig()
    await until(() => r.tg.offsets().length >= 2)
    const w = watchdog(r)
    expect(await w.run()).toBe(0)
    expect(w.sentTexts()).toEqual([])
    expect(r.tg.sent()).toEqual([])
  })

  test('dead gateway: alerts by text and by direct Telegram once, then announces recovery', async () => {
    const r = await rig()
    const w = watchdog(r)
    await r.stop()

    expect(await w.run()).toBe(1)
    expect(w.sentTexts().length).toBe(1)
    expect(w.sentTexts()[0]).toContain("Tanya's Telegram gateway is down on the Mac")
    expect(w.sentTexts()[0]).toContain('--send')
    expect(r.tg.sent().length).toBe(1)
    expect(r.tg.sent()[0]).toEndWith('\n- EA Tanya')

    expect(await w.run()).toBe(1) // still down five minutes later: no repeat
    expect(w.sentTexts().length).toBe(1)
    expect(r.tg.sent().length).toBe(1)

    await r.start()
    await until(() => r.tg.offsets().length >= 2)
    await Bun.sleep(300)
    expect(await w.run()).toBe(0)
    expect(w.sentTexts()[1]).toContain('working again')
    expect(r.tg.sent()[1]).toContain('working again')
    const logged = readFileSync(join(r.gwDir, 'watchdog.log'), 'utf8')
    expect(logged).not.toContain(TOKEN)
  }, 30000)
})
