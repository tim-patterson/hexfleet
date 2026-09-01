import { describe, expect, it } from 'vitest'
import { BOARD_RADIUS, cellsFor, key } from '@hexfleet/shared'
import type { Fleet } from '@hexfleet/shared'
import { join, legalFleet, openCells } from './helpers.js'

/**
 * A hex on the eastern rim that neither fixture fleet occupies (both sit at
 * q -2..2), derived from the radius so it follows the board if it changes.
 */
const OPEN_WATER = { q: BOARD_RADIUS, r: 0 }

/** Seat 1's fleet in the default battle fixture. */
const FOE = legalFleet(-5)

/** Two captains locked in and the battle running, seat 0 to play. */
async function battle(code: string, fleets: [Fleet, Fleet] = [legalFleet(0), legalFleet(-5)]) {
  const a = await join(code, 'Ada')
  const b = await join(code, 'Bo')
  await a.client.until('seatJoined')
  a.client.send({ type: 'lockFleet', fleet: fleets[0] })
  b.client.send({ type: 'lockFleet', fleet: fleets[1] })
  await b.client.until('seatReady')
  await b.client.until('seatReady')
  a.client.send({ type: 'startBattle' })
  await a.client.until('battleStarted')
  await b.client.until('battleStarted')
  return { a, b }
}

describe('fire', () => {
  it('records a miss and passes the turn', async () => {
    const { a, b } = await battle('TIDE-01')
    a.client.send({ type: 'fire', ...OPEN_WATER })
    const shot = await b.client.until('shotFired')
    expect(shot).toMatchObject({ seat: 0, ...OPEN_WATER, hits: [], sunk: [] })
    const turn = await b.client.until('turnAdvanced')
    expect(turn.turn).toBe(1)
  })

  it('strikes a captain whose hull is on the hex', async () => {
    const { a, b } = await battle('TIDE-02')
    a.client.send({ type: 'fire', ...FOE.carrier[0]! })
    const shot = await b.client.until('shotFired')
    expect(shot.hits).toEqual([1])
  })

  it('strikes several captains sharing one hex', async () => {
    // Both fleets deliberately on the same rows.
    const { a } = await battle('TIDE-03', [legalFleet(0), legalFleet(0)])
    a.client.send({ type: 'fire', ...legalFleet(0).carrier[0]! })
    const shot = await a.client.until('shotFired')
    expect(shot.hits).toEqual([0, 1])
  })

  it('damages the shooter too when they fire on their own hull', async () => {
    const { a } = await battle('TIDE-04', [legalFleet(0), legalFleet(0)])
    a.client.send({ type: 'fire', ...legalFleet(0).tug[0]! })
    const shot = await a.client.until('shotFired')
    expect(shot.hits).toContain(0)
  })

  it('reports a sunk hull when its last cell is struck', async () => {
    const { a, b } = await battle('TIDE-05')
    // Strike both cells of seat 1's two-cell tug to sink it.
    a.client.send({ type: 'fire', ...FOE.tug[0]! })
    await a.client.until('shotFired')
    await a.client.until('turnAdvanced')
    b.client.send({ type: 'fire', ...OPEN_WATER })
    await a.client.until('turnAdvanced')
    a.client.send({ type: 'fire', ...FOE.tug[1]! })
    const shot = await a.client.until('shotFired')
    expect(shot.sunk).toEqual([{ seat: 1, shipId: 'tug' }])
  })

  it('refuses a shot out of turn', async () => {
    const { b } = await battle('TIDE-06')
    b.client.send({ type: 'fire', ...OPEN_WATER })
    const err = await b.client.until('error')
    expect(err.code).toBe('notYourTurn')
  })

  it('refuses a hex that has already been shot', async () => {
    const { a, b } = await battle('TIDE-07')
    a.client.send({ type: 'fire', ...OPEN_WATER })
    await a.client.until('turnAdvanced')
    b.client.send({ type: 'fire', ...OPEN_WATER })
    const err = await b.client.until('error')
    expect(err.code).toBe('alreadyShot')
  })

  it('refuses a hex off the board', async () => {
    const { a } = await battle('TIDE-08')
    a.client.send({ type: 'fire', q: 40, r: 40 })
    const err = await a.client.until('error')
    expect(err.code).toBe('offBoard')
  })

  it('refuses a shot before the battle starts', async () => {
    const a = await join('TIDE-09', 'Ada')
    a.client.send({ type: 'fire', q: 0, r: 0 })
    const err = await a.client.until('error')
    expect(err.code).toBe('wrongPhase')
  })
})

describe('game over', () => {
  it('ends when only one fleet is left afloat', async () => {
    // Seat 1 gets a tiny corner fleet that seat 0 can sink hex by hex.
    const tiny: Fleet = {
      carrier: cellsFor({ q: 0, r: -8 }, 0, 5),
      cutter: cellsFor({ q: 0, r: -7 }, 0, 4),
      trawler: cellsFor({ q: 0, r: -6 }, 0, 3),
      skiff: cellsFor({ q: 0, r: -5 }, 0, 3),
      tug: cellsFor({ q: 0, r: -4 }, 0, 2),
    }
    const fleets: [Fleet, Fleet] = [legalFleet(0), tiny]
    const { a, b } = await battle('TIDE-10', fleets)

    const targets = Object.values(tiny).flat()
    // Bo's harmless replies must land on open water — never on either
    // fleet's hulls, and never off the board (the brief's original inline
    // `{ q: 9 - (filler % 3), r: filler++ }` computation drifts off the
    // hexagon by the third shot, which the server correctly rejects with
    // `offBoard`, stalling the turn forever).
    const filler = openCells(BOARD_RADIUS, ...fleets)
    let fillerIdx = 0
    // Two fixes over the brief's original loop, both needed to make it
    // terminate:
    //  1. Every message is broadcast to both sockets (emit() fans out to all
    //     seated captains, not just the actor), so polling `b.client` here
    //     would pop A's still-unread broadcasts instead of B's own reply --
    //     a growing desync that means later messages are read increasingly
    //     out of order. Routing every read through `a.client` keeps one
    //     correctly ordered view of the whole exchange, matching the pattern
    //     already used above in "reports a sunk hull when its last cell is
    //     struck".
    //  2. `applyShot` always emits `shotFired` before either `gameEnded` or
    //     `turnAdvanced`, so the message immediately after a fire is never
    //     `gameEnded` -- checking for it there is dead code. The real
    //     end-of-game signal is whichever event follows `shotFired`.
    for (const t of targets) {
      a.client.send({ type: 'fire', q: t.q, r: t.r })
      await a.client.until('shotFired')
      const after = await a.client.next()
      if (after.type === 'gameEnded') {
        expect(after.winner).toBe(0)
        return
      }
      // Seat 1 answers with a harmless shot so play returns to seat 0.
      const cell = filler[fillerIdx++]!
      b.client.send({ type: 'fire', q: cell.q, r: cell.r })
      await a.client.until('shotFired')
      const after2 = await a.client.next()
      if (after2.type === 'gameEnded') {
        expect(after2.winner).toBe(0)
        return
      }
    }
    throw new Error('the game never ended')
  })

  it('stops accepting shots after the game ends', async () => {
    const tiny: Fleet = {
      carrier: cellsFor({ q: 0, r: -8 }, 0, 5),
      cutter: cellsFor({ q: 0, r: -7 }, 0, 4),
      trawler: cellsFor({ q: 0, r: -6 }, 0, 3),
      skiff: cellsFor({ q: 0, r: -5 }, 0, 3),
      tug: cellsFor({ q: 0, r: -4 }, 0, 2),
    }
    const fleets: [Fleet, Fleet] = [legalFleet(0), tiny]
    const { a, b } = await battle('TIDE-11', fleets)
    const targets = Object.values(tiny).flat()
    const filler = openCells(BOARD_RADIUS, ...fleets)
    let fillerIdx = 0
    let ended = false
    // Same two fixes as the test above: read everything through `a.client`,
    // and check for `gameEnded` on the message that follows `shotFired`,
    // not the immediate next message (which is always `shotFired` itself).
    for (const t of targets) {
      a.client.send({ type: 'fire', q: t.q, r: t.r })
      await a.client.until('shotFired')
      const after = await a.client.next()
      if (after.type === 'gameEnded') {
        ended = true
        break
      }
      const cell = filler[fillerIdx++]!
      b.client.send({ type: 'fire', q: cell.q, r: cell.r })
      await a.client.until('shotFired')
      const after2 = await a.client.next()
      if (after2.type === 'gameEnded') {
        ended = true
        break
      }
    }
    expect(ended).toBe(true)
    a.client.send({ type: 'fire', q: 5, r: 5 })
    const err = await a.client.until('error')
    expect(err.code).toBe('wrongPhase')
  })
})

describe('shot map', () => {
  it('shows up in a resynced snapshot', async () => {
    const { a } = await battle('TIDE-12')
    a.client.send({ type: 'fire', ...OPEN_WATER })
    await a.client.until('turnAdvanced')
    a.client.send({ type: 'resync' })
    const snap = await a.client.until('snapshot')
    expect(snap.shots[key(OPEN_WATER.q, OPEN_WATER.r)]).toEqual({ by: 0, hits: [] })
  })
})

describe('secrecy', () => {
  it('never leaks a partial hit count to other captains', async () => {
    const { a, b } = await battle('TIDE-13')
    // Seat 1's cutter (len 4) sits at (-2,7)..(1,7). One shot leaves it
    // struck but not sunk.
    a.client.send({ type: 'fire', ...FOE.cutter[0]! })
    await a.client.until('shotFired')
    await a.client.until('turnAdvanced')

    a.client.send({ type: 'resync' })
    const snapA = await a.client.until('snapshot')
    b.client.send({ type: 'resync' })
    const snapB = await b.client.until('snapshot')

    const cutterAsSeenByOwner = snapB.seats.find((s) => s.seat === 1)!.ships.find(
      (sh) => sh.shipId === 'cutter',
    )!
    expect(cutterAsSeenByOwner.hits).toBe(1)
    expect(cutterAsSeenByOwner.sunk).toBe(false)

    const cutterAsSeenByOpponent = snapA.seats.find((s) => s.seat === 1)!.ships.find(
      (sh) => sh.shipId === 'cutter',
    )!
    expect(cutterAsSeenByOpponent.hits).toBe(0)
    expect(cutterAsSeenByOpponent.sunk).toBe(false)
  })
})

describe('self-fire', () => {
  // Self-fire used to deal no damage while still consuming the hex, which let
  // a captain spend their turns shooting their own hulls to make the fleet
  // unsinkable. Now it damages like any other shot, so it costs a hull rather
  // than protecting one.
  it('sinks the captain\'s own hull, so it cannot be used as a shield', async () => {
    const mine = legalFleet(0)
    const { a, b } = await battle('TIDE-20', [mine, FOE])

    // Ada shoots both cells of her own tug, taking a Bo turn in between.
    a.client.send({ type: 'fire', ...mine.tug[0]! })
    const first = await a.client.until('shotFired')
    expect(first.hits).toContain(0)
    expect(first.sunk).toEqual([])
    await a.client.until('turnAdvanced')

    b.client.send({ type: 'fire', ...OPEN_WATER })
    await a.client.until('turnAdvanced')

    a.client.send({ type: 'fire', ...mine.tug[1]! })
    const second = await a.client.until('shotFired')
    expect(second.sunk).toEqual([{ seat: 0, shipId: 'tug' }])

    // And Ada's own view agrees her tug is gone.
    a.client.send({ type: 'resync' })
    const snap = await a.client.until('snapshot')
    const tug = snap.seats[0]!.ships.find((s) => s.shipId === 'tug')!
    expect(tug.sunk).toBe(true)
  })
})
