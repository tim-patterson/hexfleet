import {
  ADRIFT_AFTER,
  BOARD_RADIUS,
  boardCells,
  IDLE_EVICT_MS,
  inBounds,
  isAlive,
  key,
  MAX_SEATS,
  MIN_SEATS,
  nextTurn,
  PALETTE,
  resolveShot,
  seatStats,
  shipStatuses,
  sunkBy,
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
        // Bump lastActivityAt so scheduleAlarm() times the idle window from
        // this write, not from whatever it was left at (e.g. an eviction's
        // freshState() on a DO instance the runtime kept warm) -- otherwise
        // the alarm it arms can already be in the past.
        this.state.lastActivityAt = Date.now()
        await this.persist()
        await this.scheduleAlarm()
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
    // See the matching comment in fetch()'s /ws branch: without this, a
    // re-claim of a code the runtime evicted but kept warm in memory would
    // time its alarm from the stale eviction-time lastActivityAt instead of
    // from now.
    this.state.lastActivityAt = Date.now()
    await this.persist()
    await this.scheduleAlarm()
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
    await this.scheduleAlarm()

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
      case 'fire':
        return this.onFire(ws, seat, { q: msg.q, r: msg.r })
      case 'rematch':
        return this.onRematch(ws, seat)
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
    // `seatReady` reaches every captain, so it deliberately carries no fleet.
    // That would leave the owner's own `myFleet` stale -- null, if they joined
    // without one -- and the waiting and battle boards read `myFleet` rather
    // than local placement, so the captain would watch the battle with their
    // own sea empty. Unicast a fresh snapshot to the owner alone;
    // `snapshotFor` redacts per seat, so this leaks nothing.
    await this.sendSnapshot(ws, seat)
  }

  protected async onUnlockFleet(ws: WebSocket, seat: number): Promise<void> {
    if (this.state.phase !== 'lobby') {
      return this.fail(ws, 'wrongPhase', 'Fleets are locked once the battle starts.')
    }
    const s = this.state.seats.find((x) => x.seat === seat)!
    if (!s.ready) return
    s.ready = false
    delete this.state.fleets[seat]
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
    await this.scheduleAlarm()
  }

  /**
   * Host-only, and only once a game has finished. Returns the table to
   * `lobby`, keeping the code, seats, names and colours so captains do not
   * have to rejoin — only the per-game state (fleets, shots, winner, and
   * each seat's ready/adrift/timeouts) is cleared. Critically, `state.seats`
   * is mutated in place (via `for...of`), never reordered, spliced, or
   * rebuilt: `onStartBattle` picks the opening turn as `ready[0]!.seat`,
   * which depends on `state.seats` staying in insertion order across a
   * rematch.
   */
  protected async onRematch(ws: WebSocket, seat: number): Promise<void> {
    if (this.state.phase !== 'results') {
      return this.fail(ws, 'wrongPhase', 'The table has not finished its game.')
    }
    if (seat !== this.state.hostSeat) {
      return this.fail(ws, 'notHost', 'Only the captain who set the table can restart it.')
    }

    this.state.phase = 'lobby'
    this.state.fleets = {}
    this.state.shots = {}
    this.state.winner = null
    this.state.turn = this.state.hostSeat
    this.state.turnDeadline = 0
    for (const s of this.state.seats) {
      s.ready = false
      s.adrift = false
      s.timeouts = 0
    }
    await this.emit({ type: 'rematchStarted' })
    await this.scheduleAlarm()
  }

  protected async onFire(ws: WebSocket, seat: number, hex: { q: number; r: number }): Promise<void> {
    if (this.state.phase !== 'battle') return this.fail(ws, 'wrongPhase', 'No battle is running.')
    if (this.state.turn !== seat) return this.fail(ws, 'notYourTurn', 'It is not your turn.')
    if (!Number.isInteger(hex.q) || !Number.isInteger(hex.r) || !inBounds(hex, BOARD_RADIUS)) {
      return this.fail(ws, 'offBoard', 'That hex is not on the sea.')
    }
    if (this.state.shots[key(hex.q, hex.r)]) {
      return this.fail(ws, 'alreadyShot', 'That hex has already been fired on.')
    }
    const me = this.state.seats.find((x) => x.seat === seat)
    if (me) me.timeouts = 0
    await this.applyShot(seat, hex)
  }

  /** Resolve a shot, announce it, then either end the game or pass the turn. */
  protected async applyShot(seat: number, hex: { q: number; r: number }): Promise<void> {
    const hits = resolveShot(this.state.fleets, seat, hex)
    this.state.shots[key(hex.q, hex.r)] = { by: seat, hits }
    const sunk = sunkBy(this.state.fleets, this.state.shots, hex)

    await this.emit({ type: 'shotFired', seat, q: hex.q, r: hex.r, hits, sunk })

    if (await this.checkGameOver()) return
    await this.advanceTurn()
  }

  /** Seats with a fleet still afloat. */
  protected livingSeats(): number[] {
    return this.state.seats
      .filter((s) => isAlive(this.state.fleets[s.seat], this.state.shots, s.seat))
      .map((s) => s.seat)
  }

  /** A seat can take a turn if its fleet is afloat and it has not gone adrift. */
  protected playable(seat: number): boolean {
    const s = this.state.seats.find((x) => x.seat === seat)
    if (!s || s.adrift) return false
    return isAlive(this.state.fleets[seat], this.state.shots, seat)
  }

  /** Ends the game when one fleet is left, or when everyone left is adrift. */
  protected async checkGameOver(): Promise<boolean> {
    const living = this.livingSeats()
    const anyPlayable = living.some((s) => this.playable(s))
    if (living.length > 1 && anyPlayable) return false

    this.state.phase = 'results'
    this.state.winner = living.length === 1 ? living[0]! : null
    this.state.turnDeadline = 0
    await this.emit({ type: 'gameEnded', winner: this.state.winner })
    // Phase is already 'results' here, so scheduleAlarm() takes its
    // non-battle path and arms lastActivityAt + idleMs() — the eviction
    // deadline a finished table needs. Using deleteAlarm() here (as Task 8
    // left it) would leave no alarm armed at all: onFire's winning-shot path
    // never re-arms afterward, and onTurnExpired's auto-fire path only
    // re-arms `if (phase === 'battle')`, which is false the instant this
    // function flips the phase. A finished table that nobody revisits would
    // then live forever.
    await this.scheduleAlarm()
    return true
  }

  protected async advanceTurn(): Promise<void> {
    const order = this.state.seats.map((s) => s.seat)
    this.state.turn = nextTurn(this.state.turn, order, (s) => this.playable(s))
    this.state.turnDeadline = this.turnDeadlineNow()
    await this.emit({
      type: 'turnAdvanced',
      turn: this.state.turn,
      turnDeadline: this.state.turnDeadline,
    })
    await this.scheduleAlarm()
  }

  protected turnMs(): number {
    const raw = Number(this.env.TURN_MS)
    return Number.isFinite(raw) && raw > 0 ? raw : TURN_MS
  }

  protected turnDeadlineNow(): number {
    return Date.now() + this.turnMs()
  }

  protected idleMs(): number {
    const raw = Number(this.env.IDLE_MS)
    return Number.isFinite(raw) && raw > 0 ? raw : IDLE_EVICT_MS
  }

  /**
   * A Durable Object has one alarm slot, so it always points at whichever
   * deadline comes first; alarm() works out which job it was woken for.
   */
  protected async scheduleAlarm(): Promise<void> {
    // A battling table is never idle-evicted (see alarm()'s eviction guard),
    // so the turn deadline is the only clock that matters mid-battle. Mixing
    // in the idle deadline here would let it land before the turn deadline
    // whenever nobody has sent a message in a while (server-driven auto-fires
    // do not bump lastActivityAt) — the DO would wake early, find neither
    // job actionable, and re-arm the same already-past idle timestamp
    // forever, so the turn would never actually expire.
    const at =
      this.state.phase === 'battle' && this.state.turnDeadline > 0
        ? this.state.turnDeadline
        : this.state.lastActivityAt + this.idleMs()
    await this.ctx.storage.setAlarm(at)
  }

  async alarm(): Promise<void> {
    const now = Date.now()

    if (this.state.phase === 'battle' && this.state.turnDeadline > 0 && now >= this.state.turnDeadline - 50) {
      await this.onTurnExpired()
      if (this.state.phase === 'battle') await this.scheduleAlarm()
      return
    }

    if (this.state.phase !== 'battle' && now >= this.state.lastActivityAt + this.idleMs()) {
      await this.ctx.storage.deleteAll()
      this.state = freshState('', Date.now())
      for (const ws of this.ctx.getWebSockets()) ws.close(1001, 'table closed')
      return
    }

    await this.scheduleAlarm()
  }

  protected async onTurnExpired(): Promise<void> {
    const seat = this.state.turn
    const s = this.state.seats.find((x) => x.seat === seat)
    if (!s) return this.advanceTurn()

    s.timeouts += 1
    const goingAdrift = s.timeouts >= ADRIFT_AFTER && !s.adrift
    if (goingAdrift) s.adrift = true

    const hex = this.randomOpenHex()
    if (goingAdrift) await this.emit({ type: 'seatAdrift', seat })
    if (hex) await this.applyShot(seat, hex)
    else await this.checkGameOver()
  }

  protected randomOpenHex(): { q: number; r: number } | null {
    const open = boardCells(BOARD_RADIUS).filter((c) => !this.state.shots[key(c.q, c.r)])
    if (open.length === 0) return null
    return open[Math.floor(Math.random() * open.length)]!
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
      await this.scheduleAlarm()
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
    await this.scheduleAlarm()
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
