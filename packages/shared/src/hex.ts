export type Hex = { q: number; r: number }
export type HexKey = string

/** The three axes a hull can lie along: E–W, NW–SE, NE–SW. */
export const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
] as const

export const BOARD_RADIUS = 10

export function key(q: number, r: number): HexKey {
  return `${q},${r}`
}

export function parseKey(k: HexKey): Hex {
  const [q, r] = k.split(',')
  return { q: Number(q), r: Number(r) }
}

export function inBounds(h: Hex, radius: number): boolean {
  return Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) <= radius
}

export function boardCells(radius: number): Hex[] {
  const out: Hex[] = []
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius)
    const hi = Math.min(radius, -q + radius)
    for (let r = lo; r <= hi; r++) out.push({ q, r })
  }
  return out
}

/** Cell radius in px, chosen so the whole board stays on screen. */
export function hexSize(radius: number): number {
  if (radius >= 13) return 13
  if (radius >= 9) return 18
  if (radius >= 6) return 24
  return 30
}

export type Layout = {
  pos: Record<HexKey, { cx: number; cy: number }>
  /** Rendered diameter of one cell, with the inter-cell gap already removed. */
  d: number
  minX: number
  minY: number
  W: number
  H: number
}

/** Pointy-top axial layout, matching the design prototype's geometry(). */
export function layout(cells: Hex[], size: number): Layout {
  const d = size * Math.sqrt(3) - Math.max(3, size * 0.22)
  const pos: Record<HexKey, { cx: number; cy: number }> = {}
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of cells) {
    const cx = size * Math.sqrt(3) * (c.q + c.r / 2)
    const cy = size * 1.5 * c.r
    pos[key(c.q, c.r)] = { cx, cy }
    minX = Math.min(minX, cx)
    maxX = Math.max(maxX, cx)
    minY = Math.min(minY, cy)
    maxY = Math.max(maxY, cy)
  }
  return { pos, d, minX: minX - d / 2, minY: minY - d / 2, W: maxX - minX + d, H: maxY - minY + d }
}
