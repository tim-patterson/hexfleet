import { describe, expect, it } from 'vitest'
import { SHIPS } from '@hexfleet/shared'
import { join, legalFleet } from './helpers.js'

describe('lockFleet', () => {
  it('marks the seat ready and tells the table', async () => {
    const a = await join('KELP-01', 'Ada')
    const b = await join('KELP-01', 'Bo')
    await a.client.until('seatJoined')

    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    const ready = await b.client.until('seatReady')
    expect(ready.seat).toBe(0)
  })

  it("returns the locked fleet in the owner's next snapshot", async () => {
    const a = await join('KELP-02', 'Ada')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    await a.client.until('seatReady')
    a.client.send({ type: 'resync' })
    const snap = await a.client.until('snapshot')
    expect(snap.myFleet).toEqual(legalFleet(0))
  })

  // The owner must get their fleet back WITHOUT asking for it. A real client
  // never sends `resync` after locking, so if the server only emits
  // `seatReady` (which carries no fleet, deliberately -- it is broadcast to
  // every captain), the owner's `myFleet` stays null from join time. Deploy
  // mode hides that because it draws from local placement state, but the
  // waiting and battle boards read `snap.myFleet` and would show the captain
  // an empty sea where their own fleet should be.
  it('pushes the locked fleet to its owner unprompted', async () => {
    const a = await join('KELP-13', 'Ada')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    const snap = await a.client.until('snapshot')
    expect(snap.myFleet).toEqual(legalFleet(0))
  })

  it('does not push a fleet snapshot to the other captains', async () => {
    const a = await join('KELP-14', 'Ada')
    const b = await join('KELP-14', 'Bo')
    await a.client.until('seatJoined')

    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    // Bo sees the readiness event, and nothing carrying Ada's hulls.
    const ready = await b.client.until('seatReady')
    expect(ready.seat).toBe(0)
    b.client.send({ type: 'resync' })
    const bobSnap = await b.client.until('snapshot')
    expect(bobSnap.myFleet).toBeNull()
    for (const cell of Object.values(legalFleet(0)).flat()) {
      expect(JSON.stringify(bobSnap)).not.toContain(`{"q":${cell.q},"r":${cell.r}}`)
    }
  })

  it('rejects an illegal fleet and leaves the seat unready', async () => {
    const a = await join('KELP-03', 'Ada')
    const bad = legalFleet(0)
    bad.tug = [{ q: 0, r: 0 }, { q: 5, r: 5 }]
    a.client.send({ type: 'lockFleet', fleet: bad })
    const err = await a.client.until('error')
    expect(err.code).toBe('badFleet')
    a.client.send({ type: 'resync' })
    const snap = await a.client.until('snapshot')
    expect(snap.seats[0]!.ready).toBe(false)
  })

  it('accepts two captains whose hulls overlap each other', async () => {
    const a = await join('KELP-04', 'Ada')
    const b = await join('KELP-04', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    await b.client.until('seatReady')
    const second = await b.client.until('seatReady')
    expect(second.seat).toBe(1)
  })

  it('never leaks another captain\'s hull positions', async () => {
    const a = await join('KELP-11', 'Ada')
    const b = await join('KELP-11', 'Bo')
    await a.client.until('seatJoined')

    const adaFleet = legalFleet(0)
    a.client.send({ type: 'lockFleet', fleet: adaFleet })
    await b.client.until('seatReady')

    a.client.send({ type: 'resync' })
    const adaSnap = await a.client.until('snapshot')
    expect(adaSnap.myFleet).toEqual(adaFleet)

    b.client.send({ type: 'resync' })
    const bobSnap = await b.client.until('snapshot')

    expect(bobSnap.myFleet).toBeNull()
    const serialized = JSON.stringify(bobSnap)
    expect(serialized).not.toContain('"fleets"')

    for (const spec of SHIPS) {
      for (const cell of adaFleet[spec.id]) {
        const needle = `{"q":${cell.q},"r":${cell.r}}`
        expect(serialized).not.toContain(needle)
      }
    }
  })
})

describe('unlockFleet', () => {
  it('clears ready so the captain can re-place', async () => {
    const a = await join('KELP-05', 'Ada')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    await a.client.until('seatReady')
    a.client.send({ type: 'unlockFleet' })
    const ev = await a.client.until('seatUnready')
    expect(ev.seat).toBe(0)
  })

  it('drops the retracted fleet, so the battle skips that captain entirely', async () => {
    const a = await join('KELP-12', 'Ada')
    const b = await join('KELP-12', 'Bo')
    const c = await join('KELP-12', 'Cy')
    await a.client.until('seatJoined')
    await a.client.until('seatJoined')

    const cyFleet = legalFleet(-6)
    c.client.send({ type: 'lockFleet', fleet: cyFleet })
    await c.client.until('seatReady')
    c.client.send({ type: 'unlockFleet' })
    await c.client.until('seatUnready')

    c.client.send({ type: 'resync' })
    const cySnap = await c.client.until('snapshot')
    expect(cySnap.myFleet).toBeNull()

    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')

    a.client.send({ type: 'startBattle' })
    const started = await a.client.until('battleStarted')
    // Cy unlocked her fleet before the battle started, so she sits this game
    // out exactly like a captain who never locked one at all: play opens
    // with seat 0 rather than ever landing on seat 2.
    expect(started.turn).toBe(0)

    // Firing at one of Cy's retracted hulls can never hit seat 2 -- her
    // fleet is gone from the table entirely, not just marked unready.
    const cyCell = cyFleet.tug[0]!
    a.client.send({ type: 'fire', q: cyCell.q, r: cyCell.r })
    const shot = await a.client.until('shotFired')
    expect(shot.hits).not.toContain(2)

    // Turn passes straight from seat 0 to seat 1, never pausing on seat 2.
    const turn = await a.client.until('turnAdvanced')
    expect(turn.turn).toBe(1)
  })
})

describe('startBattle', () => {
  it("starts once two captains are ready, on the host's command", async () => {
    const a = await join('KELP-06', 'Ada')
    const b = await join('KELP-06', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')

    a.client.send({ type: 'startBattle' })
    const started = await b.client.until('battleStarted')
    expect(started.turn).toBe(0)
    expect(started.turnDeadline).toBeGreaterThan(Date.now())
  })

  it('refuses a non-host', async () => {
    const a = await join('KELP-07', 'Ada')
    const b = await join('KELP-07', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')

    b.client.send({ type: 'startBattle' })
    const err = await b.client.until('error')
    expect(err.code).toBe('notHost')
  })

  it('refuses with only one captain ready', async () => {
    const a = await join('KELP-08', 'Ada')
    const b = await join('KELP-08', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    await a.client.until('seatReady')

    a.client.send({ type: 'startBattle' })
    const err = await a.client.until('error')
    expect(err.code).toBe('notReady')
  })

  it('refuses to lock a fleet once the battle has begun', async () => {
    const a = await join('KELP-09', 'Ada')
    const b = await join('KELP-09', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    b.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await b.client.until('seatReady')
    await b.client.until('seatReady')
    a.client.send({ type: 'startBattle' })
    await a.client.until('battleStarted')

    a.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    const err = await a.client.until('error')
    expect(err.code).toBe('wrongPhase')
  })

  it('starts with only the ready captains seated in the turn order', async () => {
    const a = await join('KELP-10', 'Ada')
    const b = await join('KELP-10', 'Bo')
    const c = await join('KELP-10', 'Cy')
    await a.client.until('seatJoined')
    b.client.send({ type: 'lockFleet', fleet: legalFleet(0) })
    c.client.send({ type: 'lockFleet', fleet: legalFleet(-5) })
    await c.client.until('seatReady')
    await c.client.until('seatReady')

    a.client.send({ type: 'startBattle' })
    const started = await a.client.until('battleStarted')
    // Seat 0 never locked a fleet, so play opens with seat 1.
    expect(started.turn).toBe(1)
  })
})
