import { describe, expect, it } from 'vitest'
import { key } from './hex.js'
import { cellsFor } from './ships.js'
import type { Fleet } from './ships.js'
import { isAlive, nextTurn, resolveShot, seatStats, shipStatuses, sunkBy } from './rules.js'
import type { ShotMap } from './rules.js'

function fleetAt(r: number): Fleet {
  return {
    carrier: cellsFor({ q: -2, r }, 0, 5),
    cutter: cellsFor({ q: -2, r: r + 1 }, 0, 4),
    trawler: cellsFor({ q: -2, r: r + 2 }, 0, 3),
    skiff: cellsFor({ q: -2, r: r + 3 }, 0, 3),
    tug: cellsFor({ q: -2, r: r + 4 }, 0, 2),
  }
}

/** Mark every cell of `seat`'s hull as struck. */
function sink(shots: ShotMap, fleet: Fleet, shipId: keyof Fleet, seat: number, by = 99): ShotMap {
  const out = { ...shots }
  for (const c of fleet[shipId]) {
    const k = key(c.q, c.r)
    const prev = out[k]
    out[k] = { by: prev?.by ?? by, hits: [...new Set([...(prev?.hits ?? []), seat])] }
  }
  return out
}

describe('resolveShot', () => {
  it('returns an empty list for open water', () => {
    const fleets = { 0: fleetAt(0) }
    expect(resolveShot(fleets, { q: 9, r: 0 })).toEqual([])
  })

  it('hits a captain whose hull is on the hex', () => {
    const fleets = { 0: fleetAt(0), 1: fleetAt(-6) }
    expect(resolveShot(fleets, { q: -2, r: 0 })).toEqual([0])
  })

  it('hits every captain sharing the hex at once', () => {
    // Three fleets deliberately overlapping on the same cell.
    const fleets = { 0: fleetAt(0), 1: fleetAt(0), 2: fleetAt(0) }
    expect(resolveShot(fleets, { q: -2, r: 0 }).sort()).toEqual([0, 1, 2])
  })

  // A shot is resolved against the board, not against the shooter: firing on
  // a hex your own hull sits on strikes it exactly as it strikes anyone
  // else's. Shielding your own cells was the alternative, and it made a
  // captain immortal.
  it("damages the shooter's own fleet like anyone else's", () => {
    const fleets = { 0: fleetAt(0), 1: fleetAt(0) }
    expect(resolveShot(fleets, { q: -2, r: 0 }).sort()).toEqual([0, 1])
  })

  it('can strike the shooter alone when no one else is there', () => {
    const fleets = { 0: fleetAt(0) }
    expect(resolveShot(fleets, { q: -2, r: 0 })).toEqual([0])
  })

  it('ignores seats with no fleet', () => {
    const fleets: Record<number, Fleet> = { 0: fleetAt(0) }
    expect(resolveShot(fleets, { q: -2, r: 0 })).toEqual([0])
  })
})

describe('shipStatuses', () => {
  it('reports every hull afloat on a clean board', () => {
    const st = shipStatuses(fleetAt(0), {}, 0)
    expect(st).toHaveLength(5)
    expect(st.every((s) => s.hits === 0 && !s.sunk)).toBe(true)
  })

  it('counts partial damage without sinking', () => {
    const fleet = fleetAt(0)
    const shots: ShotMap = { [key(-2, 0)]: { by: 1, hits: [0] } }
    const carrier = shipStatuses(fleet, shots, 0).find((s) => s.shipId === 'carrier')!
    expect(carrier).toMatchObject({ hits: 1, len: 5, sunk: false })
  })

  it('sinks a hull only when every cell is struck', () => {
    const fleet = fleetAt(0)
    const shots = sink({}, fleet, 'tug', 0)
    const tug = shipStatuses(fleet, shots, 0).find((s) => s.shipId === 'tug')!
    expect(tug).toMatchObject({ hits: 2, sunk: true })
  })

  it('does not count a hit credited to another captain', () => {
    const fleet = fleetAt(0)
    const shots: ShotMap = { [key(-2, 0)]: { by: 1, hits: [3] } }
    const carrier = shipStatuses(fleet, shots, 0).find((s) => s.shipId === 'carrier')!
    expect(carrier.hits).toBe(0)
  })

  it('returns all-zero statuses for a seat with no fleet', () => {
    expect(shipStatuses(undefined, {}, 0).every((s) => s.hits === 0 && !s.sunk)).toBe(true)
  })
})

describe('isAlive', () => {
  it('is true while any hull floats', () => {
    const fleet = fleetAt(0)
    let shots = sink({}, fleet, 'carrier', 0)
    shots = sink(shots, fleet, 'cutter', 0)
    expect(isAlive(fleet, shots, 0)).toBe(true)
  })

  it('is false once every hull is sunk', () => {
    const fleet = fleetAt(0)
    let shots: ShotMap = {}
    for (const id of ['carrier', 'cutter', 'trawler', 'skiff', 'tug'] as const) {
      shots = sink(shots, fleet, id, 0)
    }
    expect(isAlive(fleet, shots, 0)).toBe(false)
  })
})

describe('sunkBy', () => {
  it('names the hulls finished off by the shot at that hex', () => {
    const fleet = fleetAt(0)
    const fleets = { 0: fleet }
    const shots = sink({}, fleet, 'tug', 0)
    expect(sunkBy(fleets, shots, { q: -2, r: 4 })).toEqual([{ seat: 0, shipId: 'tug' }])
  })

  it('is empty when the hull survives the shot', () => {
    const fleet = fleetAt(0)
    const shots: ShotMap = { [key(-2, 0)]: { by: 1, hits: [0] } }
    expect(sunkBy({ 0: fleet }, shots, { q: -2, r: 0 })).toEqual([])
  })
})

describe('nextTurn', () => {
  it('advances to the next playable seat', () => {
    expect(nextTurn(0, [0, 1, 2], () => true)).toBe(1)
    expect(nextTurn(2, [0, 1, 2], () => true)).toBe(0)
  })

  it('skips unplayable seats', () => {
    expect(nextTurn(0, [0, 1, 2, 3], (s) => s === 3)).toBe(3)
  })

  it('returns the current seat when nobody else can play', () => {
    expect(nextTurn(1, [0, 1, 2], (s) => s === 1)).toBe(1)
  })
})

describe('seatStats', () => {
  it('counts shots taken and hulls struck', () => {
    const shots: ShotMap = {
      [key(0, 0)]: { by: 0, hits: [] },
      [key(1, 0)]: { by: 0, hits: [1, 2] },
      [key(2, 0)]: { by: 1, hits: [0] },
    }
    expect(seatStats(shots, 0)).toEqual({ shots: 2, hits: 2 })
    expect(seatStats(shots, 1)).toEqual({ shots: 1, hits: 1 })
    expect(seatStats(shots, 2)).toEqual({ shots: 0, hits: 0 })
  })
})
