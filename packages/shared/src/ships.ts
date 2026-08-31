import { AXES, boardCells, inBounds, key } from './hex.js'
import type { Hex, HexKey } from './hex.js'

export type ShipId = 'carrier' | 'cutter' | 'trawler' | 'skiff' | 'tug'
export type ShipSpec = { id: ShipId; name: string; len: number }

export const SHIPS: readonly ShipSpec[] = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'cutter', name: 'Cutter', len: 4 },
  { id: 'trawler', name: 'Trawler', len: 3 },
  { id: 'skiff', name: 'Skiff', len: 3 },
  { id: 'tug', name: 'Tug', len: 2 },
] as const

export const SHIP_IDS: readonly ShipId[] = SHIPS.map((s) => s.id)

export type Fleet = Record<ShipId, Hex[]>

export function cellsFor(start: Hex, axis: number, len: number): Hex[] {
  const a = AXES[axis]!
  const out: Hex[] = []
  for (let i = 0; i < len; i++) out.push({ q: start.q + a[0] * i, r: start.r + a[1] * i })
  return out
}

function isHex(v: unknown): v is Hex {
  return (
    typeof v === 'object' &&
    v !== null &&
    Number.isInteger((v as Hex).q) &&
    Number.isInteger((v as Hex).r)
  )
}

/** True if `d` is one of the three axes or its opposite. */
function isAxisStep(dq: number, dr: number): boolean {
  return AXES.some((a) => (a[0] === dq && a[1] === dr) || (-a[0] === dq && -a[1] === dr))
}

export function validateFleet(
  fleet: unknown,
  radius: number,
): { ok: true; fleet: Fleet } | { ok: false; reason: string } {
  if (typeof fleet !== 'object' || fleet === null) return { ok: false, reason: 'fleet must be an object' }
  const f = fleet as Record<string, unknown>

  const keys = Object.keys(f)
  if (keys.length !== SHIP_IDS.length || !SHIP_IDS.every((id) => keys.includes(id))) {
    return { ok: false, reason: `fleet must contain exactly: ${SHIP_IDS.join(', ')}` }
  }

  const occupied = new Set<HexKey>()
  for (const spec of SHIPS) {
    const cells = f[spec.id]
    if (!Array.isArray(cells) || !cells.every(isHex)) {
      return { ok: false, reason: `${spec.id} must be an array of {q,r}` }
    }
    if (cells.length !== spec.len) {
      return { ok: false, reason: `${spec.id} must have length ${spec.len}` }
    }
    if (!cells.every((c) => inBounds(c, radius))) {
      return { ok: false, reason: `${spec.id} runs off the board` }
    }
    if (spec.len > 1) {
      const dq = cells[1]!.q - cells[0]!.q
      const dr = cells[1]!.r - cells[0]!.r
      if (!isAxisStep(dq, dr)) return { ok: false, reason: `${spec.id} is not on a hex axis` }
      for (let i = 1; i < cells.length; i++) {
        if (cells[i]!.q - cells[i - 1]!.q !== dq || cells[i]!.r - cells[i - 1]!.r !== dr) {
          return { ok: false, reason: `${spec.id} is not contiguous along one axis` }
        }
      }
    }
    for (const c of cells) {
      const k = key(c.q, c.r)
      if (occupied.has(k)) return { ok: false, reason: `${spec.id} overlaps another of your hulls` }
      occupied.add(k)
    }
  }
  return { ok: true, fleet: f as Fleet }
}

export function fleetCells(fleet: Fleet, skip?: ShipId): Map<HexKey, ShipId> {
  const m = new Map<HexKey, ShipId>()
  for (const spec of SHIPS) {
    if (spec.id === skip) continue
    for (const c of fleet[spec.id] ?? []) m.set(key(c.q, c.r), spec.id)
  }
  return m
}

/** Scatter a legal fleet. Mirrors the design's "Scatter" button. */
export function randomFleet(radius: number, rng: () => number = Math.random): Fleet {
  const cells = boardCells(radius)
  const used = new Set<HexKey>()
  const out: Partial<Fleet> = {}
  for (const spec of SHIPS) {
    let placed = false
    for (let attempt = 0; attempt < 2000 && !placed; attempt++) {
      const start = cells[Math.floor(rng() * cells.length)]!
      const axis = Math.floor(rng() * AXES.length)
      const cs = cellsFor(start, axis, spec.len)
      if (cs.every((c) => inBounds(c, radius) && !used.has(key(c.q, c.r)))) {
        cs.forEach((c) => used.add(key(c.q, c.r)))
        out[spec.id] = cs
        placed = true
      }
    }
    if (!placed) throw new Error(`could not place ${spec.id} on radius ${radius}`)
  }
  return out as Fleet
}
