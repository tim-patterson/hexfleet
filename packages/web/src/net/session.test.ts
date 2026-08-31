import { describe, expect, it } from 'vitest'
import { PALETTE, SHIPS } from '@hexfleet/shared'
import type { PublicSeat, ServerMsg, Snapshot } from '@hexfleet/shared'
import { initialSession, receive } from './session.js'

function seat(n: number): PublicSeat {
  return {
    seat: n,
    name: `C${n}`,
    color: PALETTE[n]!,
    ready: false,
    adrift: false,
    connected: true,
    ships: SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false })),
    shots: 0,
    hitsDealt: 0,
  }
}

const snapshot: Snapshot = {
  type: 'snapshot',
  seq: 5,
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
}

describe('receive', () => {
  it('stores the token and seat from welcome', () => {
    const s = receive(initialSession(), { type: 'welcome', token: 'tok', seat: 3 })
    expect(s).toMatchObject({ token: 'tok', seat: 3 })
  })

  it('adopts a snapshot and clears the resync flag', () => {
    let s = initialSession()
    s = { ...s, needsResync: true }
    s = receive(s, snapshot)
    expect(s.snapshot).toEqual(snapshot)
    expect(s.needsResync).toBe(false)
  })

  it('applies an in-order event', () => {
    let s = receive(initialSession(), snapshot)
    s = receive(s, { type: 'seatReady', seq: 6, seat: 1 })
    expect(s.snapshot!.seats[1]!.ready).toBe(true)
    expect(s.snapshot!.seq).toBe(6)
  })

  it('flags a gap and does not apply the out-of-order event', () => {
    let s = receive(initialSession(), snapshot)
    s = receive(s, { type: 'seatReady', seq: 9, seat: 1 })
    expect(s.needsResync).toBe(true)
    expect(s.snapshot!.seats[1]!.ready).toBe(false)
    expect(s.snapshot!.seq).toBe(5)
  })

  it('ignores a replayed event it has already applied', () => {
    let s = receive(initialSession(), snapshot)
    s = receive(s, { type: 'seatReady', seq: 4, seat: 1 })
    expect(s.needsResync).toBe(false)
    expect(s.snapshot!.seq).toBe(5)
  })

  it('stays in the resync state until a snapshot arrives', () => {
    let s = receive(initialSession(), snapshot)
    s = receive(s, { type: 'seatReady', seq: 9, seat: 1 })
    s = receive(s, { type: 'seatReady', seq: 10, seat: 1 })
    expect(s.needsResync).toBe(true)
    s = receive(s, { ...snapshot, seq: 10 })
    expect(s.needsResync).toBe(false)
    expect(s.snapshot!.seq).toBe(10)
  })

  it('drops events that arrive before any snapshot', () => {
    const s = receive(initialSession(), { type: 'seatReady', seq: 1, seat: 0 })
    expect(s.snapshot).toBeNull()
    expect(s.needsResync).toBe(true)
  })

  it('records an error without disturbing the snapshot', () => {
    let s = receive(initialSession(), snapshot)
    s = receive(s, { type: 'error', code: 'notYourTurn', message: 'Not your turn.' })
    expect(s.error).toEqual({ code: 'notYourTurn', message: 'Not your turn.' })
    expect(s.snapshot).toEqual(snapshot)
  })

  it('clears a stale error on the next successful event', () => {
    let s = receive(initialSession(), snapshot)
    s = receive(s, { type: 'error', code: 'x', message: 'y' })
    s = receive(s, { type: 'seatReady', seq: 6, seat: 1 })
    expect(s.error).toBeNull()
  })

  it('never mutates the session it is given', () => {
    const s0 = receive(initialSession(), snapshot)
    const before = JSON.stringify(s0)
    receive(s0, { type: 'seatReady', seq: 6, seat: 1 })
    expect(JSON.stringify(s0)).toBe(before)
  })

  it('ignores an unknown message shape', () => {
    const s0 = receive(initialSession(), snapshot)
    const s1 = receive(s0, { type: 'nonsense' } as unknown as ServerMsg)
    expect(s1.snapshot).toEqual(snapshot)
  })
})
