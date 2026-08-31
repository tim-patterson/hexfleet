import { describe, expect, it } from 'vitest'
import { boardCells, key } from './hex.js'
import { cellsFor, fleetCells, randomFleet, SHIPS, validateFleet } from './ships.js'
import type { Fleet } from './ships.js'

/** A fleet laid out in five disjoint E–W rows near the middle of the board. */
function legalFleet(): Fleet {
  return {
    carrier: cellsFor({ q: -2, r: 0 }, 0, 5),
    cutter: cellsFor({ q: -2, r: 1 }, 0, 4),
    trawler: cellsFor({ q: -2, r: 2 }, 0, 3),
    skiff: cellsFor({ q: -2, r: 3 }, 0, 3),
    tug: cellsFor({ q: -2, r: 4 }, 0, 2),
  }
}

describe('SHIPS', () => {
  it('is the five hulls from the design', () => {
    expect(SHIPS.map((s) => [s.id, s.len])).toEqual([
      ['carrier', 5],
      ['cutter', 4],
      ['trawler', 3],
      ['skiff', 3],
      ['tug', 2],
    ])
  })
})

describe('cellsFor', () => {
  it('walks the requested axis', () => {
    expect(cellsFor({ q: 0, r: 0 }, 1, 3)).toEqual([
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: 0, r: 2 },
    ])
    expect(cellsFor({ q: 0, r: 0 }, 2, 2)).toEqual([
      { q: 0, r: 0 },
      { q: -1, r: 1 },
    ])
  })
})

describe('validateFleet', () => {
  it('accepts a legal fleet', () => {
    const res = validateFleet(legalFleet(), 10)
    expect(res.ok).toBe(true)
  })

  it('accepts hulls on each of the three axes', () => {
    for (const axis of [0, 1, 2]) {
      const fleet: Fleet = {
        carrier: cellsFor({ q: 0, r: 0 }, axis, 5),
        cutter: cellsFor({ q: 3, r: -6 }, 0, 4),
        trawler: cellsFor({ q: -6, r: 3 }, 0, 3),
        skiff: cellsFor({ q: 4, r: 4 }, 0, 3),
        tug: cellsFor({ q: -4, r: -4 }, 0, 2),
      }
      expect(validateFleet(fleet, 10).ok, `axis ${axis}`).toBe(true)
    }
  })

  it('accepts a hull listed in reverse order', () => {
    const fleet = legalFleet()
    fleet.tug = [...fleet.tug].reverse()
    expect(validateFleet(fleet, 10).ok).toBe(true)
  })

  it('rejects a missing hull', () => {
    const fleet = legalFleet() as Partial<Fleet>
    delete fleet.tug
    const res = validateFleet(fleet, 10)
    expect(res).toMatchObject({ ok: false })
  })

  it('rejects a hull of the wrong length', () => {
    const fleet = legalFleet()
    fleet.tug = cellsFor({ q: -2, r: 4 }, 0, 3)
    expect(validateFleet(fleet, 10)).toMatchObject({ ok: false, reason: expect.stringContaining('length') })
  })

  it('rejects a non-contiguous hull', () => {
    const fleet = legalFleet()
    fleet.tug = [
      { q: -2, r: 4 },
      { q: 2, r: 4 },
    ]
    expect(validateFleet(fleet, 10)).toMatchObject({ ok: false })
  })

  it('rejects a bent hull', () => {
    const fleet = legalFleet()
    fleet.trawler = [
      { q: -2, r: 2 },
      { q: -1, r: 2 },
      { q: -1, r: 3 },
    ]
    expect(validateFleet(fleet, 10)).toMatchObject({ ok: false })
  })

  it('rejects a hull hanging off the board', () => {
    const fleet = legalFleet()
    fleet.carrier = cellsFor({ q: 8, r: 0 }, 0, 5)
    expect(validateFleet(fleet, 10)).toMatchObject({ ok: false, reason: expect.stringContaining('board') })
  })

  it("rejects two of the captain's own hulls overlapping", () => {
    const fleet = legalFleet()
    fleet.tug = cellsFor({ q: -2, r: 0 }, 0, 2)
    expect(validateFleet(fleet, 10)).toMatchObject({ ok: false, reason: expect.stringContaining('overlap') })
  })

  it('rejects a non-object', () => {
    expect(validateFleet(null, 10)).toMatchObject({ ok: false })
    expect(validateFleet('carrier', 10)).toMatchObject({ ok: false })
  })

  it('rejects cells that are not finite integers', () => {
    const fleet = legalFleet() as unknown as Record<string, unknown>
    fleet.tug = [{ q: 0.5, r: 0 }, { q: 1.5, r: 0 }]
    expect(validateFleet(fleet, 10)).toMatchObject({ ok: false })
  })
})

describe('fleetCells', () => {
  it('maps every occupied hex to its hull', () => {
    const m = fleetCells(legalFleet())
    expect(m.size).toBe(17)
    expect(m.get(key(-2, 0))).toBe('carrier')
    expect(m.get(key(-1, 4))).toBe('tug')
  })

  it('omits the skipped hull', () => {
    const m = fleetCells(legalFleet(), 'carrier')
    expect(m.size).toBe(12)
    expect(m.has(key(-2, 0))).toBe(false)
  })
})

describe('randomFleet', () => {
  it('always produces a fleet that validates', () => {
    for (let i = 0; i < 50; i++) {
      expect(validateFleet(randomFleet(10), 10).ok).toBe(true)
    }
  })

  it('fits on the smallest board the game allows', () => {
    expect(validateFleet(randomFleet(3), 3).ok).toBe(true)
  })

  it('is deterministic for a given rng', () => {
    const seq = () => {
      let i = 0
      const vals = boardCells(10).map((_, n) => ((n * 9301 + 49297) % 233280) / 233280)
      return () => vals[i++ % vals.length]!
    }
    expect(randomFleet(10, seq())).toEqual(randomFleet(10, seq()))
  })
})
