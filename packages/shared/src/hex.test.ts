import { describe, expect, it } from 'vitest'
import { AXES, boardCells, hexSize, inBounds, key, layout, parseKey } from './hex.js'

describe('key', () => {
  it('round-trips through parseKey', () => {
    expect(parseKey(key(-3, 7))).toEqual({ q: -3, r: 7 })
  })

  it('is distinct for coordinates that share digits', () => {
    expect(key(1, 23)).not.toBe(key(12, 3))
  })
})

describe('boardCells', () => {
  it('produces 3R^2 + 3R + 1 cells', () => {
    expect(boardCells(0)).toHaveLength(1)
    expect(boardCells(1)).toHaveLength(7)
    expect(boardCells(10)).toHaveLength(331)
  })

  it('produces no duplicates', () => {
    const cells = boardCells(10)
    expect(new Set(cells.map((c) => key(c.q, c.r))).size).toBe(cells.length)
  })

  it('contains only in-bounds cells', () => {
    expect(boardCells(4).every((c) => inBounds(c, 4))).toBe(true)
  })
})

describe('inBounds', () => {
  it('accepts the centre and the three axis extremes', () => {
    expect(inBounds({ q: 0, r: 0 }, 10)).toBe(true)
    expect(inBounds({ q: 10, r: 0 }, 10)).toBe(true)
    expect(inBounds({ q: 0, r: 10 }, 10)).toBe(true)
    expect(inBounds({ q: -10, r: 10 }, 10)).toBe(true)
  })

  it('rejects cells past the radius on the q+r diagonal', () => {
    expect(inBounds({ q: 6, r: 6 }, 10)).toBe(false)
    expect(inBounds({ q: 11, r: 0 }, 10)).toBe(false)
  })
})

describe('AXES', () => {
  it('is the three hex axes from the design', () => {
    expect(AXES).toEqual([
      [1, 0],
      [0, 1],
      [-1, 1],
    ])
  })
})

describe('hexSize', () => {
  it('shrinks the cell as the board grows', () => {
    expect(hexSize(4)).toBe(30)
    expect(hexSize(7)).toBe(24)
    expect(hexSize(10)).toBe(18)
    expect(hexSize(15)).toBe(13)
  })
})

describe('layout', () => {
  it('places every cell inside the reported bounds', () => {
    const cells = boardCells(5)
    const g = layout(cells, hexSize(5))
    for (const c of cells) {
      const p = g.pos[key(c.q, c.r)]!
      expect(p.cx - g.minX).toBeGreaterThanOrEqual(0)
      expect(p.cx - g.minX).toBeLessThanOrEqual(g.W)
      expect(p.cy - g.minY).toBeGreaterThanOrEqual(0)
      expect(p.cy - g.minY).toBeLessThanOrEqual(g.H)
    }
  })

  it('gives distinct positions to distinct cells', () => {
    const cells = boardCells(3)
    const g = layout(cells, hexSize(3))
    const seen = new Set(Object.values(g.pos).map((p) => `${p.cx.toFixed(4)}/${p.cy.toFixed(4)}`))
    expect(seen.size).toBe(cells.length)
  })
})
