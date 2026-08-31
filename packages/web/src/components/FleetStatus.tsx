import { SHIPS } from '@hexfleet/shared'
import type { ShipStatus } from '@hexfleet/shared'
import { ACCENT_DEEP, HEAD, MUTED, SHADOW_SM, SUNK, SURFACE } from '../theme.js'

export function FleetStatus({ ships, color }: { ships: ShipStatus[]; color: string }) {
  return (
    <>
      {ships.map((s) => {
        const spec = SHIPS.find((x) => x.id === s.shipId)!
        const status = s.sunk ? 'Sunk' : s.hits ? `${s.hits} of ${s.len} struck` : 'Afloat'
        return (
          <div key={s.shipId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 13.2, padding: '13.2px 17.6px', borderRadius: 28, background: SURFACE, boxShadow: SHADOW_SM, opacity: s.sunk ? 0.55 : 1 }}>
            <div>
              <div style={{ fontFamily: HEAD, fontSize: 16, textDecoration: s.sunk ? 'line-through' : 'none' }}>{spec.name}</div>
              <div style={{ fontSize: 12, color: s.sunk ? SUNK : s.hits ? ACCENT_DEEP : MUTED }}>{status}</div>
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: s.len }, (_, i) => (
                <div key={i} style={{ width: 13, height: 13, borderRadius: 999, background: i < s.hits ? (s.sunk ? SUNK : ACCENT_DEEP) : color }} />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
