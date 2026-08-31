import type { Phase, PublicSeat } from '@hexfleet/shared'
import { ACCENT_PALE, FAINT, GREEN, HEAD, INK, MUTED, PAPER, SHADOW_MD, SUNK } from '../theme.js'

type Props = {
  seats: PublicSeat[]
  mySeat: number
  phase: Phase
  turn: number
  title: string
  timer: string | null
}

export function PlayerRail({ seats, mySeat, phase, turn, title, timer }: Props) {
  return (
    <div style={{ width: 270, flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 13.2 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8.8 }}>
        <div style={{ fontFamily: HEAD, fontSize: 20 }}>{title}</div>
        {timer && (
          <div style={{ padding: '4.4px 13.2px', borderRadius: 999, background: ACCENT_PALE, fontWeight: 700, fontSize: 14 }}>{timer}</div>
        )}
      </div>
      {seats.map((p) => {
        const afloat = p.ships.filter((s) => !s.sunk).length
        const current = phase === 'battle' && turn === p.seat
        let sub: string
        if (phase === 'lobby') sub = p.ready ? 'Ready' : 'Still placing…'
        else if (p.adrift) sub = `Adrift · ${afloat} of ${p.ships.length} afloat`
        else sub = afloat ? `${afloat} of ${p.ships.length} afloat` : 'Fleet destroyed'

        return (
          <div
            key={p.seat}
            style={{ display: 'flex', alignItems: 'center', gap: 13.2, padding: '11px 17.6px', borderRadius: 28, background: current ? PAPER : phase === 'lobby' && p.ready ? GREEN : 'transparent', boxShadow: current ? SHADOW_MD : 'none', opacity: p.connected ? 1 : 0.6 }}
          >
            <div style={{ width: 26, height: 26, borderRadius: 999, flex: 'none', background: p.color, boxShadow: current ? '0 0 0 4px rgba(198,113,57,0.22)' : 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: current || p.seat === mySeat ? 700 : 400, fontSize: 15, color: phase !== 'lobby' && afloat === 0 ? SUNK : INK }}>
                {p.seat === mySeat ? `${p.name} (you)` : p.name}
              </div>
              <div style={{ fontSize: 12.5, color: MUTED }}>{sub}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {phase !== 'lobby' &&
                p.ships.map((s) => (
                  <div key={s.shipId} style={{ width: 9, height: 9, borderRadius: 999, background: s.sunk ? FAINT : p.color }} />
                ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
