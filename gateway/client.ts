/**
 * Socket client for the gateway, shared by channel.ts and cli.ts.
 *
 * One JSON object per line each way. Requests carry an id and get exactly
 * one reply; the gateway may also push {event:'message'} lines at any time.
 * The client reconnects by itself, so a gateway restart (launchd kickstart,
 * a crash) heals without restarting the assistant session.
 */
import { connect, type Socket } from 'net'
import { LAUNCHD_LABEL, SOCKET, type QueueItem, type Reply } from './common'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class GatewayClient {
  private sock: Socket | null = null
  private buf = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private closed = false
  connected = false

  constructor(
    private hello: { role: 'channel' | 'tool'; label: string },
    private onMessage?: (item: QueueItem) => void,
    private log: (msg: string) => void = () => {},
    private reconnect = true,
  ) {}

  /** Resolves once the first connection attempt has finished, either way. */
  start(): Promise<boolean> {
    return new Promise(resolve => this.open(resolve))
  }

  private open(first?: (ok: boolean) => void): void {
    if (this.closed) return
    const settle = (ok: boolean) => { first?.(ok); first = undefined }
    const sock = connect(SOCKET)
    this.sock = sock
    sock.on('connect', () => {
      this.connected = true
      this.buf = ''
      this.log('connected to gateway')
      this.request('hello', { ...this.hello, pid: process.pid }).then(() => settle(true), () => settle(false))
    })
    sock.on('data', d => {
      this.buf += d.toString()
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg: Reply
        try { msg = JSON.parse(line) } catch { continue }
        if ('event' in msg) { this.onMessage?.(msg.item); continue }
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error))
      }
    })
    sock.on('error', () => {})
    sock.on('close', () => {
      const was = this.connected
      this.connected = false
      this.sock = null
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('gateway connection lost')) }
      this.pending.clear()
      if (was) this.log('gateway connection lost')
      settle(false)
      if (this.reconnect && !this.closed) setTimeout(() => this.open(), 2000)
    })
  }

  request(op: string, args: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.sock || !this.connected) {
        reject(new Error(
          'the Telegram gateway is not running. Check it with bin/tg-status; restart with ' +
          `\`launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}\`. Nothing was sent.`,
        ))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`gateway did not answer "${op}" within ${timeoutMs / 1000}s`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.sock.write(JSON.stringify({ id, op, ...args }) + '\n')
    })
  }

  close(): void {
    this.closed = true
    this.sock?.destroy()
  }
}
