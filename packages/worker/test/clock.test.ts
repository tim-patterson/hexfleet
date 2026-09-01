import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BOARD_RADIUS, cellsFor } from '@hexfleet/shared'
import type { Fleet } from '@hexfleet/shared'
import type { Env } from '../src/index.js'
import { join, legalFleet, openCells, ORIGIN } from './helpers.js'

const workerEnv = env as unknown as Env

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

describe('turn clock', () => {
  it('auto-fires and passes the turn when the clock runs out', async () => {
    const { b } = await battle('DUNE-01')
    const shot = await b.client.until('shotFired')
    expect(shot.seat).toBe(0)
    const turn = await b.client.until('turnAdvanced')
    expect(turn.turn).toBe(1)
  }, 10_000)

  it('auto-fires at a hex that has not been shot', async () => {
    const { a, b } = await battle('DUNE-02')
    const first = await b.client.until('shotFired')
    await b.client.until('turnAdvanced')
    const second = await b.client.until('shotFired')
    expect(`${second.q},${second.r}`).not.toBe(`${first.q},${first.r}`)
    void a
  }, 10_000)

  it('marks a captain adrift after three expiries', async () => {
    const { b } = await battle('DUNE-03')
    const adrift = await b.client.until('seatAdrift')
    expect(adrift.seat).toBe(0)
  }, 15_000)

  it('clears adrift when the captain reconnects', async () => {
    const a = await join('DUNE-04', 'Ada')
    const b = await join('DUNE-04', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')
    a.client.send({ type: 'startBattle' })
    await b.client.until('battleStarted')

    await b.client.until('seatAdrift')
    a.client.close()

    const { connect } = await import('./helpers.js')
    const again = await connect('DUNE-04')
    again.send({ type: 'hello', token: a.token })
    await again.until('snapshot')
    const returned = await b.client.until('seatReturned')
    expect(returned.seat).toBe(0)
  }, 20_000)
})

describe('idle eviction', () => {
  it('forgets a lobby that nobody touches', async () => {
    const first = await join('DUNE-05', 'Ada')
    expect(first.seat).toBe(0)
    first.client.close()

    await new Promise((r) => setTimeout(r, 1500))

    // The table is gone, so the next arrival is seated at 0 again with a
    // clean roster, and the old token no longer works.
    const { connect } = await import('./helpers.js')
    const stale = await connect('DUNE-05')
    stale.send({ type: 'hello', token: first.token })
    const err = await stale.until('error')
    expect(err.code).toBe('badToken')
  }, 15_000)

  it('does not evict a table in the middle of a battle', async () => {
    const { b } = await battle('DUNE-06')
    await new Promise((r) => setTimeout(r, 1500))
    b.client.send({ type: 'resync' })
    const snap = await b.client.until('snapshot')
    expect(snap.phase).not.toBe('lobby')
    expect(snap.seats).toHaveLength(2)
  }, 15_000)

  it('forgets a finished table that nobody touches', async () => {
    // Seat 1 gets a tiny corner fleet that seat 0 can sink hex by hex, same
    // shape as the "game over" fleet in battle.test.ts.
    const tiny: Fleet = {
      carrier: cellsFor({ q: 0, r: -8 }, 0, 5),
      cutter: cellsFor({ q: 0, r: -7 }, 0, 4),
      trawler: cellsFor({ q: 0, r: -6 }, 0, 3),
      skiff: cellsFor({ q: 0, r: -5 }, 0, 3),
      tug: cellsFor({ q: 0, r: -4 }, 0, 2),
    }
    const fleets: [Fleet, Fleet] = [legalFleet(0), tiny]
    const { a, b } = await battle('DUNE-07', fleets)

    const targets = Object.values(tiny).flat()
    // Bo's harmless replies land on open water only -- never on either
    // fleet's hulls, never off the board.
    const filler = openCells(BOARD_RADIUS, ...fleets)
    let fillerIdx = 0
    let ended = false
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

    // The table is now in "results" with nobody sending it any more
    // traffic. It must still be idle-evicted, exactly like a lobby that
    // nobody touches: the old seat token stops working.
    await new Promise((r) => setTimeout(r, 1500))

    const { connect } = await import('./helpers.js')
    const stale = await connect('DUNE-07')
    stale.send({ type: 'hello', token: a.token })
    const err = await stale.until('error')
    expect(err.code).toBe('badToken')
  }, 20_000)

  it('frees a code that was claimed but never joined', async () => {
    // Mirrors mintCode()'s own way of reaching the DO's /claim route
    // directly, bypassing POST /api/tables (which always picks a random
    // code) so the test can claim and re-claim this exact code.
    const code = 'DUNE-08'
    const id = workerEnv.TABLES.idFromName(code)
    const stub = workerEnv.TABLES.get(id)

    const first = await stub.fetch(`https://do/claim?code=${code}`, { method: 'POST' })
    expect(((await first.json()) as { claimed: boolean }).claimed).toBe(true)

    // Nobody ever joins this table. Without an alarm armed at claim time the
    // code would be reserved forever; claim()'s scheduleAlarm() call is what
    // lets the idle clock reclaim it here.
    await new Promise((r) => setTimeout(r, 1500))

    const again = await stub.fetch(`https://do/claim?code=${code}`, { method: 'POST' })
    expect(((await again.json()) as { claimed: boolean }).claimed).toBe(true)
  }, 15_000)

  it('frees a table whose socket connected but never said hello', async () => {
    // A raw connection that never sends `hello` still has the /ws branch's
    // persist() write `state.code` -- it must arm the idle alarm too, or the
    // socket (and the code behind it) is orphaned forever. The alarm's own
    // eviction path closes every open socket with 1001, so a close event
    // arriving within the idle window is the discriminating signal: without
    // the fix, no alarm is ever armed and this socket is never closed.
    const res = await SELF.fetch('https://api.test/api/tables/DUNE-09/ws', {
      headers: { Origin: ORIGIN, Upgrade: 'websocket' },
    })
    const ws = res.webSocket
    if (!ws) throw new Error(`no websocket in response (status ${res.status})`)
    ws.accept()

    const closed = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket was never closed')), 5000)
      ws.addEventListener('close', (e) => {
        clearTimeout(timer)
        resolve(e.code)
      })
    })

    const code = await closed
    expect(code).toBe(1001)
  }, 15_000)
})
