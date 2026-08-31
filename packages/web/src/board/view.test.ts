import { describe, expect, it } from 'vitest'
import { cellsFor, key, PALETTE } from '@hexfleet/shared'
import type { Fleet } from '@hexfleet/shared'
import { buildBoard } from './view.js'
import { MISS, SEA, SUNK } from '../theme.js'

const radius = 4

function fleet(): Fleet {
  return {
    carrier: cellsFor({ q: -2, r: 0 }, 0, 5),
    cutter: cellsFor({ q: -2, r: 1 }, 0, 4),
    trawler: cellsFor({ q: -2, r: 2 }, 0, 3),
    skiff: cellsFor({ q: -2, r: -1 }, 0, 3),
    tug: cellsFor({ q: -2, r: -2 }, 0, 2),
  }
}

const base = {
  radius,
  mode: 'battle' as const,
  myFleet: null as Fleet | null,
  mySeat: 0,
  myColor: PALETTE[0]!,
  shots: {},
  seatColors: { 0: PALETTE[0]!, 1: PALETTE[1]! },
  hover: null,
  preview: null,
  sunkShips: new Set<string>(),
}

describe('buildBoard', () => {
  it('renders one cell per board hex', () => {
    expect(buildBoard(base).cells).toHaveLength(61)
  })

  it('paints untouched water as sea', () => {
    const cell = buildBoard(base).cells.find((c) => c.k === key(0, 0))!
    expect(cell.bg).toBe(SEA)
    expect(cell.dots).toEqual([])
  })

  it('paints a miss and gives it a grey pip', () => {
    const view = buildBoard({ ...base, shots: { [key(0, 0)]: { by: 1, hits: [] } } })
    const cell = view.cells.find((c) => c.k === key(0, 0))!
    expect(cell.bg).toBe(MISS)
    expect(cell.dots).toHaveLength(1)
  })

  it('gives a hit one pip per struck captain, in their colours', () => {
    const view = buildBoard({ ...base, shots: { [key(0, 0)]: { by: 0, hits: [0, 1] } } })
    const cell = view.cells.find((c) => c.k === key(0, 0))!
    expect(cell.dots.map((d) => d.color)).toEqual([PALETTE[0], PALETTE[1]])
  })

  it("shows the captain's own hulls in their colour", () => {
    const view = buildBoard({ ...base, myFleet: fleet() })
    const cell = view.cells.find((c) => c.k === key(-2, 0))!
    expect(cell.bg).toBe(PALETTE[0])
  })

  it('draws a hull bar between consecutive cells of each hull', () => {
    const view = buildBoard({ ...base, myFleet: fleet() })
    // 4 + 3 + 2 + 2 + 1 segments across the five hulls.
    expect(view.hulls).toHaveLength(12)
  })

  it("greys a sunk hull's bars", () => {
    const view = buildBoard({ ...base, myFleet: fleet(), sunkShips: new Set(['tug']) })
    expect(view.hulls.some((h) => h.color === SUNK)).toBe(true)
  })

  it('marks a legal placement preview green and an illegal one orange', () => {
    const ok = buildBoard({ ...base, mode: 'deploy', preview: { cells: cellsFor({ q: 0, r: 0 }, 0, 3), ok: true } })
    const bad = buildBoard({ ...base, mode: 'deploy', preview: { cells: cellsFor({ q: 0, r: 0 }, 0, 3), ok: false } })
    expect(ok.cells.find((c) => c.k === key(0, 0))!.bg).toBe('#aebf92')
    expect(bad.cells.find((c) => c.k === key(0, 0))!.bg).toBe('#ffc6a5')
  })

  it('lifts the hovered cell during battle but not while waiting', () => {
    const battle = buildBoard({ ...base, hover: { q: 0, r: 0 } })
    expect(battle.cells.find((c) => c.k === key(0, 0))!.scale).toBeGreaterThan(1)
    const waiting = buildBoard({ ...base, mode: 'waiting', hover: { q: 0, r: 0 } })
    expect(waiting.cells.find((c) => c.k === key(0, 0))!.scale).toBe(1)
  })

  it('reports a positive board size', () => {
    const view = buildBoard(base)
    expect(view.width).toBeGreaterThan(0)
    expect(view.height).toBeGreaterThan(0)
  })
})
