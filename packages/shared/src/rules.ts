import { key } from './hex.js'
import type { Hex, HexKey } from './hex.js'
import { fleetCells, SHIPS } from './ships.js'
import type { Fleet, ShipId } from './ships.js'

export type Shot = { by: number; hits: number[] }
export type ShotMap = Record<HexKey, Shot>
export type ShipStatus = { shipId: ShipId; len: number; hits: number; sunk: boolean }

/**
 * Which seats have a hull on `hex` -- the shooter included.
 *
 * A shot is resolved against the board, not against the captain who fired it,
 * so firing on a hex your own hull sits on strikes it exactly as it strikes
 * anyone else's. The shooter used to be excluded, but because a hex can only
 * ever be fired once, that let a captain spend their turns shooting their own
 * hulls to consume those cells and make the fleet unsinkable.
 */
export function resolveShot(fleets: Record<number, Fleet>, hex: Hex): number[] {
  const k = key(hex.q, hex.r)
  const out: number[] = []
  for (const [seatStr, fleet] of Object.entries(fleets)) {
    if (fleetCells(fleet).has(k)) out.push(Number(seatStr))
  }
  return out.sort((a, b) => a - b)
}

export function shipStatuses(
  fleet: Fleet | undefined,
  shots: ShotMap,
  seat: number,
): ShipStatus[] {
  return SHIPS.map((spec) => {
    const cells = fleet?.[spec.id] ?? []
    const hits = cells.filter((c) => shots[key(c.q, c.r)]?.hits.includes(seat)).length
    return { shipId: spec.id, len: spec.len, hits, sunk: cells.length > 0 && hits === cells.length }
  })
}

export function isAlive(fleet: Fleet | undefined, shots: ShotMap, seat: number): boolean {
  if (!fleet) return false
  return shipStatuses(fleet, shots, seat).some((s) => !s.sunk)
}

/** Hulls whose final cell was the one at `hex`, given `shots` already includes it. */
export function sunkBy(
  fleets: Record<number, Fleet>,
  shots: ShotMap,
  hex: Hex,
): { seat: number; shipId: ShipId }[] {
  const k = key(hex.q, hex.r)
  const out: { seat: number; shipId: ShipId }[] = []
  for (const [seatStr, fleet] of Object.entries(fleets)) {
    const seat = Number(seatStr)
    const shipId = fleetCells(fleet).get(k)
    if (!shipId) continue
    const status = shipStatuses(fleet, shots, seat).find((s) => s.shipId === shipId)
    if (status?.sunk) out.push({ seat, shipId })
  }
  return out
}

/** Next seat in `order` after `current` for which `playable` holds. */
export function nextTurn(
  current: number,
  order: number[],
  playable: (seat: number) => boolean,
): number {
  const at = order.indexOf(current)
  for (let i = 1; i <= order.length; i++) {
    const candidate = order[(at + i) % order.length]!
    if (playable(candidate)) return candidate
  }
  return current
}

export function seatStats(shots: ShotMap, seat: number): { shots: number; hits: number } {
  let taken = 0
  let hits = 0
  for (const shot of Object.values(shots)) {
    if (shot.by !== seat) continue
    taken += 1
    hits += shot.hits.length
  }
  return { shots: taken, hits }
}
