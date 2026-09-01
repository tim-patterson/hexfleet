import { describe, expect, it } from 'vitest'
import { BOARD_RADIUS, MAX_SEATS, PALETTE } from '@hexfleet/shared'
import { connect, join } from './helpers.js'

describe('hello', () => {
  it('seats the first captain at seat 0 as host', async () => {
    const { seat, snapshot, token } = await join('REEF-01', 'Ada')
    expect(seat).toBe(0)
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(snapshot).toMatchObject({ phase: 'lobby', hostSeat: 0, mySeat: 0, boardRadius: BOARD_RADIUS })
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

describe('reconnect visibility', () => {
  it('broadcasts an ordinary reconnect as seatReturned to a third captain', async () => {
    const a = await join('REEF-13', 'Ada')
    const b = await join('REEF-13', 'Bo')
    const c = await join('REEF-13', 'Cy')

    b.client.close()
    // A captain unrelated to the reconnect (Cy) must see the drop...
    const left = await c.client.untilMatching('seatLeft', (m) => m.seat === b.seat)
    expect(left.seat).toBe(b.seat)

    const again = await connect('REEF-13')
    again.send({ type: 'hello', token: b.token })
    await again.until('welcome')

    // ...and the ordinary reconnect — `adrift` is never set at Task 6, this
    // is a plain drop-and-reconnect — must be visible on a THIRD client's
    // socket, not just the returning client's own snapshot.
    const returned = await c.client.untilMatching('seatReturned', (m) => m.seat === b.seat)
    expect(returned.seat).toBe(b.seat)

    c.client.send({ type: 'resync' })
    const snap = await c.client.until('snapshot')
    expect(snap.seats[b.seat]!.connected).toBe(true)
  })
})

describe('concurrent hellos', () => {
  // Pins the invariant that two hellos can never be assigned the same seat,
  // which — once fleets exist in Task 7 — is the one path that could put
  // one captain's fleet under another captain's seat number. Whether this
  // actually races two `hello`s within a single input-gate batch under
  // Miniflare's scheduler, or whether the runtime just happens to run them
  // fully sequentially, is noted in the task report; either way the
  // invariant must hold.
  it('never double-allocates a seat for two hellos sent without awaiting between them', async () => {
    const a = await connect('REEF-14')
    const b = await connect('REEF-14')
    a.send({ type: 'hello', name: 'Ada' })
    b.send({ type: 'hello', name: 'Bo' })

    const [wa, wb] = await Promise.all([a.until('welcome'), b.until('welcome')])
    expect(new Set([wa.seat, wb.seat]).size).toBe(2)

    await a.until('snapshot')
    await b.until('snapshot')
    a.send({ type: 'resync' })
    const snap = await a.until('snapshot')
    expect(snap.seats.map((s) => s.seat).sort((x, y) => x - y)).toEqual([0, 1])
  })
})

describe('malformed messages', () => {
  it('rejects malformed frames without breaking other sockets', async () => {
    const bad = await connect('REEF-15')
    const good = await join('REEF-15', 'Ada')

    bad.sendRaw('null')
    expect((await bad.until('error')).code).toBe('badMessage')

    bad.sendRaw('[]')
    expect((await bad.until('error')).code).toBe('badMessage')

    // { type: 'hello', name: 123 } has a valid `type: string`, so it is not
    // rejected by the shape guard — it reaches onHello, where cleanName's
    // defensiveness against a non-string name falls through to the default
    // "Captain N" instead of throwing on `raw.trim()`. It must complete as
    // an ordinary join, not an error.
    bad.sendRaw(JSON.stringify({ type: 'hello', name: 123 }))
    const welcome = await bad.until('welcome')
    expect(welcome.seat).toBe(1)

    // Throughout, the already-seated client's socket must still work.
    good.client.send({ type: 'resync' })
    const snap = await good.client.until('snapshot')
    expect(snap.seats).toHaveLength(2)
  })
})
