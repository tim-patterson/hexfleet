import {
  BOARD_RADIUS,
  MAX_SEATS,
  PALETTE,
  seatStats,
  shipStatuses,
} from '@hexfleet/shared'
import type { ClientMsg, GameEvent, PublicSeat, ServerMsg, Snapshot } from '@hexfleet/shared'
import type { Env } from './index.js'
import { freshState, mintToken, sha256hex } from './state.js'
import type { Seat, TableState } from './state.js'

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type EventBody = DistOmit<GameEvent, 'seq'>

type Attachment = { seat: number }

export class TableDO {
  protected state!: TableState

  constructor(
    protected ctx: DurableObjectState,
    protected env: Env,
  ) {
    this.ctx.blockConcurrencyWhile(async () => {
      this.state = (await this.ctx.storage.get<TableState>('state')) ?? freshState('', Date.now())
    })
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const code = (url.searchParams.get('code') ?? '').toUpperCase()

    if (url.pathname === '/claim' && req.method === 'POST') return this.claim(code)

    if (url.pathname === '/ws') {
      if (!this.state.code) {
        this.state.code = code
        await this.persist()
      }
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    return new Response('not found', { status: 404 })
  }

  protected async claim(code: string): Promise<Response> {
    if (this.state.code) return Response.json({ claimed: false })
    this.state.code = code
    await this.persist()
    return Response.json({ claimed: true })
  }

  // ── socket lifecycle ────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMsg
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as ClientMsg
    } catch {
      return this.fail(ws, 'badMessage', 'Could not parse that message.')
    }

    if (msg.type === 'hello') return this.onHello(ws, msg)

    const seat = this.seatOf(ws)
    if (seat === null) return this.fail(ws, 'notSeated', 'Send hello first.')

    this.state.lastActivityAt = Date.now()

    switch (msg.type) {
      case 'resync':
        return this.sendSnapshot(ws, seat)
      default:
        return this.onGameMessage(ws, seat, msg)
    }
  }

  /** Overridden in later tasks to handle lockFleet / startBattle / fire / rematch. */
  protected async onGameMessage(ws: WebSocket, _seat: number, msg: ClientMsg): Promise<void> {
    return this.fail(ws, 'unsupported', `Unsupported message: ${msg.type}`)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const seat = this.seatOf(ws)
    if (seat === null) return
    const s = this.state.seats.find((x) => x.seat === seat)
    if (!s || !s.connected) return
    s.connected = false
    await this.emit({ type: 'seatLeft', seat })
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  // ── hello ───────────────────────────────────────────────────────────────

  protected async onHello(
    ws: WebSocket,
    msg: Extract<ClientMsg, { type: 'hello' }>,
  ): Promise<void> {
    if (this.seatOf(ws) !== null) {
      return this.fail(ws, 'alreadySeated', 'This socket already holds a seat.')
    }
    this.state.lastActivityAt = Date.now()

    if (msg.token) {
      const hash = await sha256hex(msg.token)
      const seat = this.state.seats.find((s) => s.tokenHash === hash)
      if (!seat) return this.fail(ws, 'badToken', 'That seat token is not valid at this table.')

      const wasAdrift = seat.adrift
      seat.connected = true
      seat.adrift = false
      seat.timeouts = 0
      this.send(ws, { type: 'welcome', token: msg.token, seat: seat.seat })
      await this.sendSnapshot(ws, seat.seat)
      // Attach after emitting: a captain rejoining doesn't need to be told
      // about their own return via the broadcast — they already got it
      // directly above — and this keeps them out of their own fan-out.
      if (wasAdrift) await this.emit({ type: 'seatReturned', seat: seat.seat })
      else await this.persist()
      ws.serializeAttachment({ seat: seat.seat } satisfies Attachment)
      return
    }

    if (this.state.seats.length >= MAX_SEATS) {
      return this.fail(ws, 'tableFull', 'All six seats at this table are taken.')
    }
    if (this.state.phase !== 'lobby') {
      return this.fail(ws, 'inProgress', 'That table has already put to sea.')
    }

    const seatNo = this.state.seats.length
    const token = mintToken()
    const seat: Seat = {
      seat: seatNo,
      name: cleanName(msg.name, seatNo),
      tokenHash: await sha256hex(token),
      ready: false,
      adrift: false,
      timeouts: 0,
      connected: true,
    }
    this.state.seats.push(seat)

    this.send(ws, { type: 'welcome', token, seat: seatNo })
    await this.sendSnapshot(ws, seatNo)
    // Attach after emitting: a new captain doesn't need a seatJoined about
    // themselves broadcast back to them — they already have their own
    // snapshot — and this keeps them out of their own fan-out.
    await this.emit({ type: 'seatJoined', seat: this.publicSeat(seat, seatNo) })
    ws.serializeAttachment({ seat: seatNo } satisfies Attachment)
  }

  // ── outbound ────────────────────────────────────────────────────────────

  protected seatOf(ws: WebSocket): number | null {
    const att = ws.deserializeAttachment() as Attachment | null
    return att ? att.seat : null
  }

  protected send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // The socket is gone; webSocketClose will tidy up.
    }
  }

  protected fail(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: 'error', code, message })
  }

  /** Assign the next sequence number, persist, then fan out to every socket. */
  protected async emit(body: EventBody): Promise<void> {
    this.state.seq += 1
    const ev = { ...body, seq: this.state.seq } as GameEvent
    await this.persist()
    for (const ws of this.ctx.getWebSockets()) {
      if (this.seatOf(ws) === null) continue
      this.send(ws, ev)
    }
  }

  protected async sendSnapshot(ws: WebSocket, seat: number): Promise<void> {
    this.send(ws, this.snapshotFor(seat))
  }

  protected snapshotFor(mySeat: number): Snapshot {
    return {
      type: 'snapshot',
      seq: this.state.seq,
      code: this.state.code,
      phase: this.state.phase,
      boardRadius: BOARD_RADIUS,
      hostSeat: this.state.hostSeat,
      mySeat,
      seats: this.state.seats.map((s) => this.publicSeat(s, mySeat)),
      myFleet: this.state.fleets[mySeat] ?? null,
      shots: this.state.shots,
      turn: this.state.turn,
      turnDeadline: this.state.turnDeadline,
      winner: this.state.winner,
    }
  }

  /**
   * Real per-hull hit counts go only to their owner. Everyone else sees a hull
   * as either sunk (hits === len) or untouched (hits === 0), which is exactly
   * what the design's player rail draws.
   */
  protected publicSeat(s: Seat, viewer: number): PublicSeat {
    const stats = seatStats(this.state.shots, s.seat)
    const fleet = this.state.fleets[s.seat]
    // Nothing to report before a fleet is locked in — and, crucially, no
    // ship-type identifiers to leak either.
    const truth = fleet ? shipStatuses(fleet, this.state.shots, s.seat) : []
    const ships =
      s.seat === viewer ? truth : truth.map((sh) => ({ ...sh, hits: sh.sunk ? sh.len : 0 }))
    return {
      seat: s.seat,
      name: s.name,
      color: PALETTE[s.seat % PALETTE.length]!,
      ready: s.ready,
      adrift: s.adrift,
      connected: s.connected,
      ships,
      shots: stats.shots,
      hitsDealt: stats.hits,
    }
  }

  protected async persist(): Promise<void> {
    await this.ctx.storage.put('state', this.state)
  }
}

function cleanName(raw: string | undefined, seatNo: number): string {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return name || `Captain ${seatNo + 1}`
}
