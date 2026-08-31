import { describe, expect, it } from 'vitest'
import { join, legalFleet } from './helpers.js'

async function battle(code: string) {
  const a = await join(code, 'Ada')
  const b = await join(code, 'Bo')
  await a.client.until('seatJoined')
  a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
  b.client.send({ type: 'lockFleet', fleet: legalFleet(6) })
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
    b.client.send({ type: 'lockFleet', fleet: legalFleet(6) })
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
})
