import { describe, expect, it } from 'vitest'
import { BOARD_RADIUS, cellsFor } from '@hexfleet/shared'
import type { Fleet } from '@hexfleet/shared'
import { join, legalFleet, openCells } from './helpers.js'

const tiny: Fleet = {
  carrier: cellsFor({ q: 0, r: -8 }, 0, 5),
  cutter: cellsFor({ q: 0, r: -7 }, 0, 4),
  trawler: cellsFor({ q: 0, r: -6 }, 0, 3),
  skiff: cellsFor({ q: 0, r: -5 }, 0, 3),
  tug: cellsFor({ q: 0, r: -4 }, 0, 2),
}

/**
 * Play a table through to results with seat 0 winning.
 *
 * The brief's original version of this helper had Bo fire filler shots at
 * `{ q: 9, r: -Object.values(tiny).flat().indexOf(t) }`. That walks `r` from
 * 0 down to -16 as the loop progresses, which quickly exceeds the board's
 * radius-10 hexagon (valid cells satisfy `max(|q|,|r|,|q+r|) <= 10`). The
 * server correctly rejects the resulting off-board shots with `offBoard`,
 * so the turn never advances and the loop hangs until timeout. Fixed here
 * by drawing filler shots from `openCells`, exactly as `battle.test.ts` and
 * `clock.test.ts` already do to play a game to completion.
 *
 * Also unlike `battle.test.ts`'s "game over" tests: this helper's callers
 * need `b.client` to be caught up afterward, to observe the `rematchStarted`
 * broadcast. `emit()` fans every message out to every seated socket in the
 * same order, so instead of routing all reads through one client (which
 * would leave the other's queue with a growing backlog of unread
 * broadcasts -- `until` only scans 50 messages ahead, so a big enough
 * backlog makes it time out even once the message it wants finally arrives),
 * both clients' queues are drained in lockstep via `bothNext`, keeping
 * both empty by the time the game ends.
 */
async function finished(code: string) {
  const a = await join(code, 'Ada')
  const b = await join(code, 'Bo')
  await a.client.until('seatJoined')
  const fleets: [Fleet, Fleet] = [legalFleet(0), tiny]
  a.client.send({ type: 'lockFleet', fleet: fleets[0] })
  b.client.send({ type: 'lockFleet', fleet: fleets[1] })
  await b.client.until('seatReady')
  await b.client.until('seatReady')
  a.client.send({ type: 'startBattle' })
  await a.client.until('battleStarted')
  await b.client.until('battleStarted')

  /** Read the next broadcast off both sockets in lockstep: both queues see
   * the exact same messages in the exact same order, so this keeps neither
   * client's queue from silently accumulating a backlog the other has
   * already consumed. */
  async function bothNext() {
    const [ma, mb] = await Promise.all([a.client.next(), b.client.next()])
    if (ma.type !== mb.type) {
      throw new Error(`clients desynced: a saw ${ma.type}, b saw ${mb.type}`)
    }
    return ma
  }

  const targets = Object.values(tiny).flat()
  const filler = openCells(BOARD_RADIUS, ...fleets)
  let fillerIdx = 0
  for (const t of targets) {
    a.client.send({ type: 'fire', q: t.q, r: t.r })
    await bothNext() // shotFired
    const after = await bothNext()
    if (after.type === 'gameEnded') return { a, b }

    const cell = filler[fillerIdx++]!
    b.client.send({ type: 'fire', q: cell.q, r: cell.r })
    await bothNext() // shotFired
    const after2 = await bothNext()
    if (after2.type === 'gameEnded') return { a, b }
  }
  throw new Error('the game never ended')
}

describe('rematch', () => {
  it('resets the table to the lobby, keeping code, seats and names', async () => {
    const { a, b } = await finished('GULL-01')
    a.client.send({ type: 'rematch' })
    await b.client.until('rematchStarted')

    b.client.send({ type: 'resync' })
    const snap = await b.client.until('snapshot')
    expect(snap.phase).toBe('lobby')
    expect(snap.code).toBe('GULL-01')
    expect(snap.shots).toEqual({})
    expect(snap.winner).toBeNull()
    expect(snap.myFleet).toBeNull()
    expect(snap.seats.map((s) => s.name)).toEqual(['Ada', 'Bo'])
    expect(snap.seats.every((s) => !s.ready && s.shots === 0)).toBe(true)
    expect(snap.seats.every((s) => s.ships.every((sh) => !sh.sunk && sh.hits === 0))).toBe(true)
  }, 20_000)

  it('lets the table play a second game', async () => {
    const { a, b } = await finished('GULL-02')
    a.client.send({ type: 'rematch' })
    await b.client.until('rematchStarted')

    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')
    a.client.send({ type: 'startBattle' })
    const started = await b.client.until('battleStarted')
    expect(started.turn).toBe(0)
  }, 25_000)

  it('refuses a non-host', async () => {
    const { b } = await finished('GULL-03')
    b.client.send({ type: 'rematch' })
    const err = await b.client.until('error')
    expect(err.code).toBe('notHost')
  }, 20_000)

  it('refuses mid-battle', async () => {
    const a = await join('GULL-04', 'Ada')
    const b = await join('GULL-04', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')
    a.client.send({ type: 'startBattle' })
    await a.client.until('battleStarted')

    a.client.send({ type: 'rematch' })
    const err = await a.client.until('error')
    expect(err.code).toBe('wrongPhase')
  }, 15_000)
})
