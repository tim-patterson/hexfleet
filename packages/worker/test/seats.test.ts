import { describe, expect, it } from 'vitest'
import { MAX_SEATS, PALETTE } from '@hexfleet/shared'
import { connect, join } from './helpers.js'

describe('hello', () => {
  it('seats the first captain at seat 0 as host', async () => {
    const { seat, snapshot, token } = await join('REEF-01', 'Ada')
    expect(seat).toBe(0)
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(snapshot).toMatchObject({ phase: 'lobby', hostSeat: 0, mySeat: 0, boardRadius: 10 })
    expect(snapshot.seats).toHaveLength(1)
    expect(snapshot.seats[0]).toMatchObject({ seat: 0, name: 'Ada', color: PALETTE[0], ready: false })
  })

  it('seats a second captain and tells the first', async () => {
    const a = await join('REEF-02', 'Ada')
    const b = await join('REEF-02', 'Bo')
    expect(b.seat).toBe(1)
    // Ada's own seatJoined (about herself) is queued ahead of Bo's — she
    // receives it too, since emit() fans out to every seated socket
    // including the actor, which is what keeps her sequence contiguous.
    // Wait for the one that is actually about Bo.
    const joined = await a.client.untilMatching('seatJoined', (m) => m.seat.seat === 1)
    expect(joined.seat).toMatchObject({ seat: 1, name: 'Bo', color: PALETTE[1] })
  })

  it('falls back to a default name', async () => {
    const { snapshot } = await join('REEF-03', '   ')
    expect(snapshot.seats[0]!.name).toBe('Captain 1')
  })

  it('truncates an over-long name', async () => {
    const { snapshot } = await join('REEF-04', 'x'.repeat(200))
    expect(snapshot.seats[0]!.name.length).toBeLessThanOrEqual(24)
  })

  it('restores the same seat when a valid token is replayed', async () => {
    const a = await join('REEF-05', 'Ada')
    a.client.close()

    const again = await connect('REEF-05')
    again.send({ type: 'hello', token: a.token })
    const welcome = await again.until('welcome')
    const snap = await again.until('snapshot')
    expect(welcome.seat).toBe(0)
    expect(snap.seats).toHaveLength(1)
    expect(snap.seats[0]!.name).toBe('Ada')
  })

  it('rejects a junk token', async () => {
    await join('REEF-06', 'Ada')
    const c = await connect('REEF-06')
    c.send({ type: 'hello', token: 'not-a-real-token' })
    const err = await c.until('error')
    expect(err.code).toBe('badToken')
  })

  it('refuses a seventh captain', async () => {
    for (let i = 0; i < MAX_SEATS; i++) await join('REEF-07', `C${i}`)
    const c = await connect('REEF-07')
    c.send({ type: 'hello', name: 'Late' })
    const err = await c.until('error')
    expect(err.code).toBe('tableFull')
  })

  it('rejects a second hello on the same socket', async () => {
    const a = await join('REEF-08', 'Ada')
    a.client.send({ type: 'hello', name: 'Ada again' })
    const err = await a.client.until('error')
    expect(err.code).toBe('alreadySeated')
  })

  it('requires hello before anything else', async () => {
    const c = await connect('REEF-09')
    c.send({ type: 'resync' })
    const err = await c.until('error')
    expect(err.code).toBe('notSeated')
  })
})

describe('snapshot redaction', () => {
  // No fleet can be locked yet at Task 6 — lockFleet arrives in Task 7 — so
  // the only meaningful assertion here is that no fleet data is present at
  // all. The real cross-captain redaction test (hits redacted to
  // sunk/untouched for another seat's locked fleet) arrives with Task 7.
  it("never sends another captain's fleet", async () => {
    const a = await join('REEF-10', 'Ada')
    const b = await join('REEF-10', 'Bo')
    expect(a.snapshot.myFleet).toBeNull()
    expect(b.snapshot.myFleet).toBeNull()
    expect(JSON.stringify(b.snapshot)).not.toContain('"fleets"')
  })
})

describe('resync', () => {
  it('returns a fresh snapshot at the current sequence', async () => {
    const a = await join('REEF-11', 'Ada')
    await join('REEF-11', 'Bo')
    await a.client.until('seatJoined')
    a.client.send({ type: 'resync' })
    const snap = await a.client.until('snapshot')
    expect(snap.seats).toHaveLength(2)
    expect(snap.seq).toBeGreaterThan(a.snapshot.seq)
  })
})

describe('disconnect', () => {
  it('marks the seat disconnected without freeing it', async () => {
    const a = await join('REEF-12', 'Ada')
    const b = await join('REEF-12', 'Bo')
    await a.client.until('seatJoined')
    b.client.close()
    const left = await a.client.until('seatLeft')
    expect(left.seat).toBe(1)
    a.client.send({ type: 'resync' })
    const snap = await a.client.until('snapshot')
    expect(snap.seats).toHaveLength(2)
    expect(snap.seats[1]!.connected).toBe(false)
  })
})
