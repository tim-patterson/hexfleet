import { describe, expect, it } from 'vitest'
import { cellsFor, key, validateFleet } from '@hexfleet/shared'
import type { Hex } from '@hexfleet/shared'
import { computePreview, placeAt, rotate } from './useDeployment.js'
import type { Placement } from './useDeployment.js'

const R = 10

describe('computePreview', () => {
  it('is null with nothing hovered', () => {
    expect(computePreview({}, null, 0, 'tug', R)).toBeNull()
  })

  it('lays the hull along the chosen axis from the hovered hex', () => {
    const pv = computePreview({}, { q: 0, r: 0 }, 1, 'trawler', R)!
    expect(pv.cells).toEqual(cellsFor({ q: 0, r: 0 }, 1, 3))
    expect(pv.ok).toBe(true)
  })

  it('is not ok when the hull runs off the board', () => {
    expect(computePreview({}, { q: 9, r: 0 }, 0, 'carrier', R)!.ok).toBe(false)
  })

  it('is not ok when the hull would cross another of your hulls', () => {
    const placement: Placement = { carrier: cellsFor({ q: -2, r: 0 }, 0, 5) }
    expect(computePreview(placement, { q: -3, r: 0 }, 0, 'tug', R)!.ok).toBe(false)
  })

  it('ignores the hull being re-placed when checking overlap', () => {
    const placement: Placement = { tug: cellsFor({ q: 0, r: 0 }, 0, 2) }
    expect(computePreview(placement, { q: 0, r: 0 }, 0, 'tug', R)!.ok).toBe(true)
  })
})

describe('placeAt', () => {
  it('adds the hull without touching the others', () => {
    const before: Placement = { carrier: cellsFor({ q: -2, r: 0 }, 0, 5) }
    const after = placeAt(before, 'tug', cellsFor({ q: -2, r: 4 }, 0, 2))
    expect(after.carrier).toEqual(before.carrier)
    expect(after.tug).toHaveLength(2)
    expect(before.tug).toBeUndefined()
  })

  it('replaces a hull that was already placed', () => {
    const before: Placement = { tug: cellsFor({ q: 0, r: 0 }, 0, 2) }
    const after = placeAt(before, 'tug', cellsFor({ q: 4, r: 4 }, 0, 2))
    expect(after.tug).toEqual(cellsFor({ q: 4, r: 4 }, 0, 2))
  })
})

describe('rotate', () => {
  it('spins a hull to the next legal axis about its middle', () => {
    const placement: Placement = { trawler: cellsFor({ q: -1, r: 0 }, 0, 3) }
    const after = rotate(placement, { q: 0, r: 0 }, R)!
    expect(after.trawler).not.toEqual(placement.trawler)
    // The pivot cell stays put.
    expect(after.trawler!.map((c: Hex) => key(c.q, c.r))).toContain(key(0, 0))
  })

  it('returns null when the hex holds no hull', () => {
    expect(rotate({}, { q: 0, r: 0 }, R)).toBeNull()
  })

  it('returns null or a legal fleet when the hull is boxed in', () => {
    // A carrier boxed in on every axis by the other four hulls.
    const placement: Placement = {
      carrier: cellsFor({ q: -2, r: 0 }, 0, 5),
      cutter: cellsFor({ q: 0, r: -2 }, 1, 4),
      trawler: cellsFor({ q: 0, r: 1 }, 1, 3),
      skiff: cellsFor({ q: 2, r: -2 }, 2, 3),
      tug: cellsFor({ q: -1, r: 1 }, 2, 2),
    }
    const res = rotate(placement, { q: -2, r: 0 }, R)
    expect(res === null || validateFleet({ ...placement, ...res }, R).ok).toBe(true)
  })

  it('never produces an illegal fleet', () => {
    const placement: Placement = {
      carrier: cellsFor({ q: -2, r: 0 }, 0, 5),
      cutter: cellsFor({ q: -2, r: 2 }, 0, 4),
      trawler: cellsFor({ q: -2, r: 4 }, 0, 3),
      skiff: cellsFor({ q: -2, r: -2 }, 0, 3),
      tug: cellsFor({ q: -2, r: -4 }, 0, 2),
    }
    const after = rotate(placement, { q: 0, r: 0 }, R)
    if (after) expect(validateFleet(after, R).ok).toBe(true)
  })
})
