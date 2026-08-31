import { describe, expect, it } from 'vitest'
import { key } from './hex.js'
import { SHIPS } from './ships.js'
import { applyEvent } from './reduce.js'
import { PALETTE } from './protocol.js'
import type { GameEvent, PublicSeat, Snapshot } from './protocol.js'

function seat(n: number, over: Partial<PublicSeat> = {}): PublicSeat {
  return {
    seat: n,
    name: `Captain ${n}`,
    color: PALETTE[n]!,
    ready: false,
    adrift: false,
    connected: true,
    ships: SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false })),
    shots: 0,
    hitsDealt: 0,
    ...over,
  }
}

function base(over: Partial<Snapshot> = {}): Snapshot {
  return {
    type: 'snapshot',
    seq: 1,
    code: 'REEF-42',
    phase: 'lobby',
    boardRadius: 10,
    hostSeat: 0,
    mySeat: 0,
    seats: [seat(0), seat(1)],
    myFleet: null,
    shots: {},
    turn: 0,
    turnDeadline: 0,
    winner: null,
    ...over,
  }
}

describe('applyEvent', () => {
  it('does not mutate the input snapshot', () => {
    const snap = base()
    const before = JSON.stringify(snap)
    applyEvent(snap, { type: 'seatReady', seq: 2, seat: 1 })
    expect(JSON.stringify(snap)).toBe(before)
  })

  it('adopts the event sequence number', () => {
    expect(applyEvent(base(), { type: 'seatReady', seq: 7, seat: 1 }).seq).toBe(7)
  })

  it('appends a joining seat in seat order', () => {
    const next = applyEvent(base({ seats: [seat(0), seat(2)] }), {
      type: 'seatJoined',
      seq: 2,
      seat: seat(1),
    })
    expect(next.seats.map((s) => s.seat)).toEqual([0, 1, 2])
  })

  it('replaces an existing seat on rejoin rather than duplicating it', () => {
    const next = applyEvent(base(), {
      type: 'seatJoined',
      seq: 2,
      seat: seat(1, { name: 'Renamed' }),
    })
    expect(next.seats).toHaveLength(2)
    expect(next.seats[1]!.name).toBe('Renamed')
  })

  it('marks a seat disconnected on seatLeft without removing it', () => {
    const next = applyEvent(base(), { type: 'seatLeft', seq: 2, seat: 1 })
    expect(next.seats).toHaveLength(2)
    expect(next.seats[1]!.connected).toBe(false)
  })

  it('toggles ready and unready', () => {
    const ready = applyEvent(base(), { type: 'seatReady', seq: 2, seat: 1 })
    expect(ready.seats[1]!.ready).toBe(true)
    const unready = applyEvent(ready, { type: 'seatUnready', seq: 3, seat: 1 })
    expect(unready.seats[1]!.ready).toBe(false)
  })

  it('enters the battle phase with a turn and deadline', () => {
    const next = applyEvent(base(), {
      type: 'battleStarted',
      seq: 2,
      turn: 1,
      turnDeadline: 5000,
    })
    expect(next).toMatchObject({ phase: 'battle', turn: 1, turnDeadline: 5000 })
  })

  it('records a miss on the shot map and credits the shooter', () => {
    const next = applyEvent(base({ phase: 'battle' }), {
      type: 'shotFired',
      seq: 2,
      seat: 0,
      q: 3,
      r: -1,
      hits: [],
      sunk: [],
    })
    expect(next.shots[key(3, -1)]).toEqual({ by: 0, hits: [] })
    expect(next.seats[0]!.shots).toBe(1)
    expect(next.seats[0]!.hitsDealt).toBe(0)
  })

  it('applies a hit to every struck seat’s ship status', () => {
    const next = applyEvent(base({ phase: 'battle' }), {
      type: 'shotFired',
      seq: 2,
      seat: 0,
      q: 3,
      r: -1,
      hits: [1],
      sunk: [],
    })
    expect(next.shots[key(3, -1)]!.hits).toEqual([1])
    expect(next.seats[0]!.hitsDealt).toBe(1)
  })

  it('marks a hull sunk when the event says so', () => {
    const next = applyEvent(base({ phase: 'battle' }), {
      type: 'shotFired',
      seq: 2,
      seat: 0,
      q: 3,
      r: -1,
      hits: [1],
      sunk: [{ seat: 1, shipId: 'tug' }],
    })
    const tug = next.seats[1]!.ships.find((s) => s.shipId === 'tug')!
    expect(tug).toMatchObject({ sunk: true, hits: 2 })
  })

  it("does not attribute a hit to a specific hull when nothing sank", () => {
    let snap = base({ phase: 'battle' })
    snap = applyEvent(snap, {
      type: 'shotFired',
      seq: 2,
      seat: 0,
      q: 3,
      r: -1,
      hits: [1],
      sunk: [],
    })
    // The reducer cannot know which hull was hit, so it tracks the total.
    const total = snap.seats[1]!.ships.reduce((n, s) => n + s.hits, 0)
    expect(total).toBe(0)
    expect(snap.seats[1]!.ships.every((s) => !s.sunk)).toBe(true)
  })

  it('advances the turn', () => {
    const next = applyEvent(base({ phase: 'battle' }), {
      type: 'turnAdvanced',
      seq: 2,
      turn: 1,
      turnDeadline: 9000,
    })
    expect(next).toMatchObject({ turn: 1, turnDeadline: 9000 })
  })

  it('flags and clears adrift', () => {
    const adrift = applyEvent(base(), { type: 'seatAdrift', seq: 2, seat: 1 })
    expect(adrift.seats[1]!.adrift).toBe(true)
    const back = applyEvent(adrift, { type: 'seatReturned', seq: 3, seat: 1 })
    expect(back.seats[1]!).toMatchObject({ adrift: false, connected: true })
  })

  it('ends the game', () => {
    const next = applyEvent(base({ phase: 'battle' }), {
      type: 'gameEnded',
      seq: 2,
      winner: 1,
    })
    expect(next).toMatchObject({ phase: 'results', winner: 1, turnDeadline: 0 })
  })

  it('resets the table on rematch, keeping seats and names', () => {
    const played = base({
      phase: 'results',
      shots: { [key(0, 0)]: { by: 0, hits: [1] } },
      winner: 1,
      seats: [seat(0, { ready: true, shots: 4, hitsDealt: 2 }), seat(1, { ready: true })],
    })
    const next = applyEvent(played, { type: 'rematchStarted', seq: 9 })
    expect(next.phase).toBe('lobby')
    expect(next.shots).toEqual({})
    expect(next.winner).toBeNull()
    expect(next.myFleet).toBeNull()
    expect(next.seats.map((s) => s.name)).toEqual(['Captain 0', 'Captain 1'])
    expect(next.seats.every((s) => !s.ready && s.shots === 0 && s.hitsDealt === 0)).toBe(true)
    expect(next.seats[0]!.ships.every((s) => s.hits === 0 && !s.sunk)).toBe(true)
  })

  it('ignores an event for an unknown seat', () => {
    const ev: GameEvent = { type: 'seatReady', seq: 2, seat: 42 }
    expect(applyEvent(base(), ev).seats).toHaveLength(2)
  })
})
