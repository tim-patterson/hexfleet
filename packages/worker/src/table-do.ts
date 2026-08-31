import {
  BOARD_RADIUS,
  MAX_SEATS,
  MIN_SEATS,
  PALETTE,
  seatStats,
  shipStatuses,
  TURN_MS,
  validateFleet,
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
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return this.fail(ws, 'badMessage', 'Could not parse that message.')
    }
    // Attacker-controlled JSON: anything that parses but isn't a
    // `{ type: string, ... }` shape must fail here, before we ever touch
    // `msg.type` or hand fields like `name` to code that assumes a string.
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as ClientMsg).type !== 'string') {
      return this.fail(ws, 'badMessage', 'Could not parse that message.')
    }
    const msg = parsed as ClientMsg

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

  /** Overridden in later tasks to handle fire / rematch. */
  protected async onGameMessage(ws: WebSocket, seat: number, msg: ClientMsg): Promise<void> {
    switch (msg.type) {
      case 'lockFleet':
        return this.onLockFleet(ws, seat, msg.fleet)
      case 'unlockFleet':
        return this.onUnlockFleet(ws, seat)
      case 'startBattle':
        return this.onStartBattle(ws, seat)
      default:
        return this.fail(ws, 'unsupported', `Unsupported message: ${msg.type}`)
    }
  }

  protected async onLockFleet(ws: WebSocket, seat: number, fleet: unknown): Promise<void> {
    if (this.state.phase !== 'lobby') {
      return this.fail(ws, 'wrongPhase', 'Fleets are locked once the battle starts.')
    }
    const res = validateFleet(fleet, BOARD_RADIUS)
    if (!res.ok) return this.fail(ws, 'badFleet', res.reason)

    this.state.fleets[seat] = res.fleet
    const s = this.state.seats.find((x) => x.seat === seat)!
    s.ready = true
    await this.emit({ type: 'seatReady', seat })
  }

  protected async onUnlockFleet(ws: WebSocket, seat: number): Promise<void> {
    if (this.state.phase !== 'lobby') {
      return this.fail(ws, 'wrongPhase', 'Fleets are locked once the battle starts.')
    }
    const s = this.state.seats.find((x) => x.seat === seat)!
    if (!s.ready) return
    s.ready = false
    await this.emit({ type: 'seatUnready', seat })
  }

  protected async onStartBattle(ws: WebSocket, seat: number): Promise<void> {
    if (this.state.phase !== 'lobby') return this.fail(ws, 'wrongPhase', 'The battle is under way.')
    if (seat !== this.state.hostSeat) {
      return this.fail(ws, 'notHost', 'Only the captain who set the table can start it.')
    }
    const ready = this.state.seats.filter((s) => s.ready)
    if (ready.length < MIN_SEATS) {
      return this.fail(ws, 'notReady', `At least ${MIN_SEATS} captains must lock a fleet.`)
    }

    // Captains who never locked a fleet stay seated but sit this game out:
    // dropping their (absent) fleet keeps isAlive false, so nextTurn skips them.
    this.state.phase = 'battle'
    this.state.turn = ready[0]!.seat
    this.state.turnDeadline = this.turnDeadlineNow()
    await this.emit({
      type: 'battleStarted',
      turn: this.state.turn,
      turnDeadline: this.state.turnDeadline,
    })
  }

  protected turnMs(): number {
    const raw = Number(this.env.TURN_MS)
    return Number.isFinite(raw) && raw > 0 ? raw : TURN_MS
  }

  protected turnDeadlineNow(): number {
    return Date.now() + this.turnMs()
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

      ws.serializeAttachment({ seat: seat.seat } satisfies Attachment)
      seat.connected = true
      seat.adrift = false
      seat.timeouts = 0
      this.send(ws, { type: 'welcome', token: msg.token, seat: seat.seat })
      await this.sendSnapshot(ws, seat.seat)
      // Unconditional: an ordinary drop-and-reconnect (adrift never having
      // been set) must still tell every other captain this seat is back —
      // seatReturned's reducer sets both adrift:false and connected:true,
      // so it's correct whether or not the seat had actually gone adrift.
      await this.emit({ type: 'seatReturned', seat: seat.seat })
      return
    }

    // Do the only await up front. From here to `this.state.seats.push(...)`
    // there must be no `await` — a Durable Object's input gate defers
    // delivery around storage operations, not around crypto awaits, so two
    // `hello`s in the same batch could otherwise both read the same
    // `seats.length` and be pushed as the same seat number.
    const token = mintToken()
    const tokenHash = await sha256hex(token)

    if (this.state.seats.length >= MAX_SEATS) {
      return this.fail(ws, 'tableFull', 'All six seats at this table are taken.')
    }
    if (this.state.phase !== 'lobby') {
      return this.fail(ws, 'inProgress', 'That table has already put to sea.')
    }

    const seatNo = this.state.seats.length
    const seat: Seat = {
      seat: seatNo,
      name: cleanName(msg.name, seatNo),
      tokenHash,
      ready: false,
      adrift: false,
      timeouts: 0,
      connected: true,
    }
    this.state.seats.push(seat)
    ws.serializeAttachment({ seat: seatNo } satisfies Attachment)

    this.send(ws, { type: 'welcome', token, seat: seatNo })
    await this.sendSnapshot(ws, seatNo)
    // Redacted for every viewer, including the joiner: a freshly allocated
    // seat can never have a fleet yet, but this is the one broadcast that
    // builds a PublicSeat with a real viewer, and Task 10's rematch returns
    // the table to lobby — so build it as nobody's view on principle rather
    // than relying on "no fleet exists yet" to keep it safe.
    await this.emit({ type: 'seatJoined', seat: this.publicSeat(seat, -1) })
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
    const truth = shipStatuses(this.state.fleets[s.seat], this.state.shots, s.seat)
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

function cleanName(raw: unknown, seatNo: number): string {
  const name = (typeof raw === 'string' ? raw : '').trim().replace(/\s+/g, ' ').slice(0, 24)
  return name || `Captain ${seatNo + 1}`
}
