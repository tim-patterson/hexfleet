import { boardCells, hexSize, key, layout, SHIPS } from '@hexfleet/shared'
import type { Fleet, Hex, Layout, ShipId, ShotMap } from '@hexfleet/shared'
import { FAINT, MISS, PAPER, SEA, SEA_HI, SUNK } from '../theme.js'

export type CellView = {
  k: string
  hex: Hex
  x: number
  y: number
  d: number
  bg: string
  shadow: string
  dots: { color: string; size: number }[]
  scale: number
  cursor: string
}

export type HullView = {
  x: number
  y: number
  len: number
  thick: number
  rot: number
  color: string
  opacity: number
}

export type BoardView = { cells: CellView[]; hulls: HullView[]; width: number; height: number }

export type BoardInput = {
  radius: number
  mode: 'deploy' | 'waiting' | 'battle' | 'results'
  myFleet: Fleet | null
  mySeat: number
  myColor: string
  shots: ShotMap
  seatColors: Record<number, string>
  hover: Hex | null
  preview: { cells: Hex[]; ok: boolean } | null
  /** Ship ids of the viewer's own hulls that have been sunk. */
  sunkShips: Set<string>
}

// `boardCells` + `layout` recompute the full trig layout for every cell
// (a couple of hundred of them) on every call. The board's geometry depends only on
// `radius`, which never changes for the life of a table, so a hover-driven
// re-render (every mouse move) would otherwise redo that work for nothing.
// Cache it per radius instead of restructuring `buildBoard`'s signature.
//
// The cached objects are shared by reference across every future call for
// that radius, so they are deep-frozen before being cached: `buildBoard`
// itself is pure and never mutates its inputs, but freezing keeps that
// property true even if some future change forgot it, instead of quietly
// corrupting every board for the rest of the process.
const geometryCache = new Map<number, { cells: readonly Hex[]; g: Layout }>()

function geometryFor(radius: number): { cells: readonly Hex[]; g: Layout } {
  let entry = geometryCache.get(radius)
  if (!entry) {
    const cells = boardCells(radius)
    for (const c of cells) Object.freeze(c)
    Object.freeze(cells)

    const g = layout(cells, hexSize(radius))
    for (const p of Object.values(g.pos)) Object.freeze(p)
    Object.freeze(g.pos)
    Object.freeze(g)

    entry = { cells, g }
    geometryCache.set(radius, entry)
  }
  return entry
}

export function buildBoard(input: BoardInput): BoardView {
  const { cells, g } = geometryFor(input.radius)

  const mine = new Map<string, ShipId>()
  if (input.myFleet) {
    for (const spec of SHIPS) {
      for (const c of input.myFleet[spec.id] ?? []) mine.set(key(c.q, c.r), spec.id)
    }
  }

  const previewKeys = new Set((input.preview?.cells ?? []).map((c) => key(c.q, c.r)))
  const isDeploy = input.mode === 'deploy'
  const isBattle = input.mode === 'battle'

  const cellViews: CellView[] = cells.map((c) => {
    const k = key(c.q, c.r)
    const shot = input.shots[k]
    let bg = SEA
    let shadow = 'inset 0 0 0 1px rgba(32,30,29,0.06)'
    let dots: CellView['dots'] = []

    if (mine.has(k)) {
      bg = input.myColor
      shadow = 'none'
    }

    if (shot) {
      if (shot.hits.length > 0) {
        bg = PAPER
        shadow = 'inset 0 0 0 2px #8c491a'
        const dotSize = Math.max(4, Math.round(g.d * (shot.hits.length > 3 ? 0.22 : 0.3)))
        dots = shot.hits.map((h) => ({ color: input.seatColors[h] ?? FAINT, size: dotSize }))
      } else {
        bg = MISS
        shadow = 'none'
        dots = [{ color: 'rgba(32,30,29,0.28)', size: Math.max(3, Math.round(g.d * 0.22)) }]
      }
    }

    if (previewKeys.has(k)) {
      const ok = input.preview!.ok
      bg = ok ? '#aebf92' : '#ffc6a5'
      shadow = `inset 0 0 0 2px ${ok ? '#56633f' : '#b2622d'}`
    }

    const hovered = !!input.hover && input.hover.q === c.q && input.hover.r === c.r
    if (isBattle && hovered && !shot) bg = SEA_HI

    const interactive = input.mode !== 'waiting' && input.mode !== 'results'
    return {
      k,
      hex: c,
      x: g.pos[k]!.cx - g.minX - g.d / 2,
      y: g.pos[k]!.cy - g.minY - g.d / 2,
      d: g.d,
      bg,
      shadow,
      dots,
      scale: hovered && !shot && interactive ? 1.08 : 1,
      cursor: !interactive ? 'default' : isDeploy ? (mine.has(k) ? 'pointer' : 'copy') : shot ? 'default' : 'crosshair',
    }
  })

  const hulls: HullView[] = []
  if (input.myFleet) {
    for (const spec of SHIPS) {
      const cs = input.myFleet[spec.id]
      if (!cs || cs.length < 2) continue
      const sunk = input.sunkShips.has(spec.id)
      for (let i = 0; i < cs.length - 1; i++) {
        const a = g.pos[key(cs[i]!.q, cs[i]!.r)]!
        const b = g.pos[key(cs[i + 1]!.q, cs[i + 1]!.r)]!
        const dx = b.cx - a.cx
        const dy = b.cy - a.cy
        hulls.push({
          x: a.cx - g.minX,
          y: a.cy - g.minY - g.d * 0.34,
          len: Math.hypot(dx, dy),
          thick: g.d * 0.68,
          rot: (Math.atan2(dy, dx) * 180) / Math.PI,
          color: sunk ? SUNK : input.myColor,
          opacity: isDeploy ? 1 : 0.85,
        })
      }
    }
  }

  return { cells: cellViews, hulls, width: Math.ceil(g.W), height: Math.ceil(g.H) }
}
