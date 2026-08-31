import { useCallback, useMemo, useState } from 'react'
import { AXES, cellsFor, inBounds, key, randomFleet, SHIPS } from '@hexfleet/shared'
import type { Fleet, Hex, ShipId } from '@hexfleet/shared'

export type Placement = Partial<Fleet>

function occupied(placement: Placement, skip?: ShipId): Set<string> {
  const out = new Set<string>()
  for (const spec of SHIPS) {
    if (spec.id === skip) continue
    for (const c of placement[spec.id] ?? []) out.add(key(c.q, c.r))
  }
  return out
}

export function computePreview(
  placement: Placement,
  hover: Hex | null,
  axis: number,
  shipId: ShipId,
  radius: number,
): { cells: Hex[]; ok: boolean } | null {
  if (!hover) return null
  const spec = SHIPS.find((s) => s.id === shipId)
  if (!spec) return null
  const cells = cellsFor(hover, axis, spec.len)
  const blocked = occupied(placement, shipId)
  const ok = cells.every((c) => inBounds(c, radius) && !blocked.has(key(c.q, c.r)))
  return { cells, ok }
}

export function placeAt(placement: Placement, shipId: ShipId, cells: Hex[]): Placement {
  return { ...placement, [shipId]: cells }
}

/** Spin the hull under `hex` to the next axis that fits, pivoting on its middle. */
export function rotate(placement: Placement, hex: Hex, radius: number): Placement | null {
  const k = key(hex.q, hex.r)
  const spec = SHIPS.find((s) => (placement[s.id] ?? []).some((c) => key(c.q, c.r) === k))
  if (!spec) return null

  const current = placement[spec.id]!
  const blocked = occupied(placement, spec.id)
  const mid = Math.floor((current.length - 1) / 2)
  const pivot = current[mid]!
  const dq = current.length > 1 ? current[1]!.q - current[0]!.q : 1
  const dr = current.length > 1 ? current[1]!.r - current[0]!.r : 0
  const from = Math.max(0, AXES.findIndex((a) => a[0] === dq && a[1] === dr))

  for (let step = 1; step <= AXES.length; step++) {
    const idx = (from + step) % AXES.length
    const a = AXES[idx]!
    const cells: Hex[] = []
    for (let i = 0; i < spec.len; i++) {
      cells.push({ q: pivot.q + a[0] * (i - mid), r: pivot.r + a[1] * (i - mid) })
    }
    if (cells.every((c) => inBounds(c, radius) && !blocked.has(key(c.q, c.r)))) {
      return placeAt(placement, spec.id, cells)
    }
  }
  return null
}

export type Deployment = {
  placement: Placement
  selected: ShipId
  axis: number
  hover: Hex | null
  dragging: ShipId | null
  preview: { cells: Hex[]; ok: boolean } | null
  complete: Fleet | null
  placedCount: number
  setAxis: (i: number) => void
  select: (id: ShipId) => void
  setHover: (h: Hex | null) => void
  setDragging: (id: ShipId | null) => void
  dropAt: (h: Hex) => boolean
  rotateAt: (h: Hex) => boolean
  scatter: () => void
  clear: () => void
  reset: (fleet: Fleet | null) => void
}

export function useDeployment(radius: number): Deployment {
  const [placement, setPlacement] = useState<Placement>({})
  const [selected, setSelected] = useState<ShipId>('carrier')
  const [axis, setAxis] = useState(0)
  const [hover, setHover] = useState<Hex | null>(null)
  const [dragging, setDragging] = useState<ShipId | null>(null)

  const active = dragging ?? selected
  const preview = useMemo(
    () =>
      hover && !occupied(placement).has(key(hover.q, hover.r))
        ? computePreview(placement, hover, axis, active, radius)
        : null,
    [placement, hover, axis, active, radius],
  )

  const placedCount = SHIPS.filter((s) => placement[s.id]).length
  const complete = placedCount === SHIPS.length ? (placement as Fleet) : null

  const dropAt = useCallback(
    (h: Hex) => {
      const pv = computePreview(placement, h, axis, active, radius)
      if (!pv || !pv.ok) {
        setHover(null)
        setDragging(null)
        return false
      }
      const next = placeAt(placement, active, pv.cells)
      setPlacement(next)
      const remaining = SHIPS.find((s) => !next[s.id])
      setSelected(remaining ? remaining.id : active)
      setHover(null)
      setDragging(null)
      return true
    },
    [placement, axis, active, radius],
  )

  const rotateAt = useCallback(
    (h: Hex) => {
      const next = rotate(placement, h, radius)
      if (!next) return false
      setPlacement(next)
      return true
    },
    [placement, radius],
  )

  return {
    placement,
    selected,
    axis,
    hover,
    dragging,
    preview,
    complete,
    placedCount,
    setAxis,
    select: setSelected,
    setHover,
    setDragging,
    dropAt,
    rotateAt,
    scatter: () => setPlacement(randomFleet(radius)),
    clear: () => {
      setPlacement({})
      setSelected('carrier')
    },
    reset: (fleet) => setPlacement(fleet ?? {}),
  }
}
