import { SHIPS } from '@hexfleet/shared'
import type { ShipId } from '@hexfleet/shared'
import type { Placement } from '../board/useDeployment.js'
import { ACCENT_PALE, FAINT, HEAD, MUTED, SHADOW_MD, SURFACE } from '../theme.js'

type Props = {
  placement: Placement
  selected: ShipId
  color: string
  onSelect: (id: ShipId) => void
  onDragStart: (id: ShipId) => void
  onDragEnd: () => void
}

export function ShipTray({ placement, selected, color, onSelect, onDragStart, onDragEnd }: Props) {
  return (
    <>
      {SHIPS.map((s) => {
        const done = !!placement[s.id]
        const sel = selected === s.id
        return (
          <div
            key={s.id}
            draggable
            onDragStart={() => onDragStart(s.id)}
            onDragEnd={onDragEnd}
            onClick={() => onSelect(s.id)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 13.2, padding: '13.2px 17.6px', borderRadius: 28, background: sel ? ACCENT_PALE : SURFACE, boxShadow: sel ? SHADOW_MD : 'none', cursor: 'grab', opacity: done ? 0.62 : 1 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontFamily: HEAD, fontSize: 16 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: MUTED }}>
                {done ? 'At sea' : 'In the yard'} · {s.len} hexes
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {Array.from({ length: s.len }, (_, i) => (
                <div key={i} style={{ width: 13, height: 13, borderRadius: 999, background: done ? color : FAINT }} />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
