import { key } from './hex.js'
import { SHIPS } from './ships.js'
import type { GameEvent, PublicSeat, Snapshot } from './protocol.js'

function freshShips(): PublicSeat['ships'] {
  return SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false }))
}

function mapSeat(
  snap: Snapshot,
  seat: number,
  fn: (s: PublicSeat) => PublicSeat,
): PublicSeat[] {
  return snap.seats.map((s) => (s.seat === seat ? fn(s) : s))
}

/** Pure: returns a new snapshot, never mutates `snap`. */
export function applyEvent(snap: Snapshot, ev: GameEvent): Snapshot {
  const seq = ev.seq

  switch (ev.type) {
    case 'seatJoined': {
      const others = snap.seats.filter((s) => s.seat !== ev.seat.seat)
      const seats = [...others, ev.seat].sort((a, b) => a.seat - b.seat)
      return { ...snap, seq, seats }
    }

    case 'seatLeft':
      return { ...snap, seq, seats: mapSeat(snap, ev.seat, (s) => ({ ...s, connected: false })) }

    case 'seatReady':
      return { ...snap, seq, seats: mapSeat(snap, ev.seat, (s) => ({ ...s, ready: true })) }

    case 'seatUnready':
      return { ...snap, seq, seats: mapSeat(snap, ev.seat, (s) => ({ ...s, ready: false })) }

    case 'battleStarted':
      return { ...snap, seq, phase: 'battle', turn: ev.turn, turnDeadline: ev.turnDeadline }

    case 'shotFired': {
      const shots = { ...snap.shots, [key(ev.q, ev.r)]: { by: ev.seat, hits: ev.hits } }
      const sunkFor = new Map<number, Set<string>>()
      for (const s of ev.sunk) {
        if (!sunkFor.has(s.seat)) sunkFor.set(s.seat, new Set())
        sunkFor.get(s.seat)!.add(s.shipId)
      }
      const seats = snap.seats.map((s) => {
        let next = s
        if (s.seat === ev.seat) {
          next = { ...next, shots: next.shots + 1, hitsDealt: next.hitsDealt + ev.hits.length }
        }
        const sunkIds = sunkFor.get(s.seat)
        if (sunkIds) {
          next = {
            ...next,
            ships: next.ships.map((sh) =>
              sunkIds.has(sh.shipId) ? { ...sh, sunk: true, hits: sh.len } : sh,
            ),
          }
        }
        return next
      })
      return { ...snap, seq, shots, seats }
    }

    case 'turnAdvanced':
      return { ...snap, seq, turn: ev.turn, turnDeadline: ev.turnDeadline }

    case 'seatAdrift':
      return { ...snap, seq, seats: mapSeat(snap, ev.seat, (s) => ({ ...s, adrift: true })) }

    case 'seatReturned':
      return {
        ...snap,
        seq,
        seats: mapSeat(snap, ev.seat, (s) => ({ ...s, adrift: false, connected: true })),
      }

    case 'gameEnded':
      return { ...snap, seq, phase: 'results', winner: ev.winner, turnDeadline: 0 }

    case 'rematchStarted':
      return {
        ...snap,
        seq,
        phase: 'lobby',
        shots: {},
        myFleet: null,
        winner: null,
        turn: snap.hostSeat,
        turnDeadline: 0,
        seats: snap.seats.map((s) => ({
          ...s,
          ready: false,
          adrift: false,
          shots: 0,
          hitsDealt: 0,
          ships: freshShips(),
        })),
      }
  }
}
