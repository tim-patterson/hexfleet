import type { Snapshot } from '@hexfleet/shared'
import { ACCENT, ACCENT_DEEP, ACCENT_PALE, BG, GREEN, GREEN_DARK, GREEN_TEXT, HEAD, MUTED, SHADOW_LG, SHADOW_MD, SURFACE } from '../theme.js'

export type Row = {
  seat: number
  name: string
  color: string
  shots: number
  hits: number
  accuracy: string
  left: string
  leftN: number
  note: string
}

export function standingsOf(snapshot: Snapshot): Row[] {
  return snapshot.seats
    .map((p) => {
      const leftN = p.ships.filter((s) => !s.sunk).length
      return {
        seat: p.seat,
        name: p.seat === snapshot.mySeat ? `${p.name} (you)` : p.name,
        color: p.color,
        shots: p.shots,
        hits: p.hitsDealt,
        accuracy: p.shots ? `${Math.round((p.hitsDealt / p.shots) * 100)}%` : '—',
        left: `${leftN} / ${p.ships.length}`,
        leftN,
        note: leftN ? '' : 'sunk',
      }
    })
    .sort((a, b) => b.leftN - a.leftN || b.hits - a.hits)
}

type Props = {
  snapshot: Snapshot
  isHost: boolean
  onRematch: () => void
  onLeave: () => void
}

export function Results({ snapshot, isHost, onRematch, onLeave }: Props) {
  const rows = standingsOf(snapshot)
  const winner = snapshot.seats.find((s) => s.seat === snapshot.winner) ?? null
  const totalShots = snapshot.seats.reduce((n, s) => n + s.shots, 0)
  const totalHits = snapshot.seats.reduce((n, s) => n + s.hitsDealt, 0)

  const line = !winner
    ? 'The sea takes them all.'
    : winner.seat === snapshot.mySeat
      ? 'You hold the sea.'
      : `${winner.name} holds the sea.`

  const headline = [
    { value: String(totalShots), label: 'Shots fired across the table' },
    { value: String(totalHits), label: 'Hulls struck' },
    { value: totalShots ? `${Math.round((totalHits / totalShots) * 100)}%` : '—', label: 'Table accuracy' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 26.4, padding: '26.4px 26.4px 52px', maxWidth: 900 }}>
      <div style={{ padding: 35.2, borderRadius: 28, background: SURFACE, boxShadow: SHADOW_LG, display: 'flex', alignItems: 'center', gap: 26.4, flexWrap: 'wrap' }}>
        <div style={{ width: 96, height: 96, borderRadius: 999, flex: 'none', background: winner?.color ?? '#dcd3c4' }} />
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8.8 }}>
          <div style={{ alignSelf: 'flex-start', padding: '4px 17.6px', borderRadius: 999, background: GREEN, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: GREEN_DARK }}>
            Table {snapshot.code} · {snapshot.seats.length} captains
          </div>
          <div style={{ fontFamily: HEAD, fontSize: 42, lineHeight: 1.12, letterSpacing: '-0.015em' }}>{line}</div>
          <div style={{ fontSize: 15, color: MUTED }}>
            {winner ? `${winner.hitsDealt} ${winner.hitsDealt === 1 ? 'hit' : 'hits'} landed · ` : ''}
            {rows[0]?.left ?? '0 / 5'} of the fleet still afloat
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 17.6, flexWrap: 'wrap' }}>
        {headline.map((h) => (
          <div key={h.label} style={{ flex: '1 1 180px', padding: 22, borderRadius: 28, background: GREEN, display: 'flex', flexDirection: 'column', gap: 4.4 }}>
            <div style={{ fontFamily: HEAD, fontSize: 32, color: GREEN_DARK }}>{h.value}</div>
            <div style={{ fontSize: 13, color: GREEN_TEXT }}>{h.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8.8 }}>
        <div style={{ fontFamily: HEAD, fontSize: 25 }}>Final log</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13.2, padding: '0 17.6px 4.4px', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
          <div style={{ width: 26, flex: 'none' }} />
          <div style={{ flex: 1 }}>Captain</div>
          <div style={{ width: 64, textAlign: 'right' }}>Shots</div>
          <div style={{ width: 64, textAlign: 'right' }}>Hits</div>
          <div style={{ width: 76, textAlign: 'right' }}>Accuracy</div>
          <div style={{ width: 84, textAlign: 'right' }}>Fleet left</div>
        </div>
        {rows.map((row, i) => (
          <div key={row.seat} style={{ display: 'flex', alignItems: 'center', gap: 13.2, padding: '15px 17.6px', borderRadius: 28, background: i === 0 ? ACCENT_PALE : SURFACE, boxShadow: i === 0 ? SHADOW_MD : 'none' }}>
            <div style={{ width: 26, height: 26, borderRadius: 999, flex: 'none', background: row.color }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8.8 }}>
              <div style={{ fontFamily: HEAD, fontSize: 17 }}>{row.name}</div>
              <div style={{ fontSize: 12.5, color: MUTED }}>{row.note}</div>
            </div>
            <div style={{ width: 64, textAlign: 'right', fontSize: 15 }}>{row.shots}</div>
            <div style={{ width: 64, textAlign: 'right', fontSize: 15, color: ACCENT_DEEP, fontWeight: 600 }}>{row.hits}</div>
            <div style={{ width: 76, textAlign: 'right', fontSize: 15 }}>{row.accuracy}</div>
            <div style={{ width: 84, textAlign: 'right', fontSize: 15 }}>{row.left}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 13.2, flexWrap: 'wrap' }}>
        {isHost && (
          <div className="press" onClick={onRematch} style={{ padding: '15px 44px', borderRadius: 999, background: ACCENT, color: BG, fontFamily: HEAD, fontSize: 16, cursor: 'pointer' }}>
            Play again
          </div>
        )}
        <div className="press" onClick={onLeave} style={{ padding: '15px 35.2px', borderRadius: 999, background: SURFACE, fontFamily: HEAD, fontSize: 16, cursor: 'pointer' }}>
          Leave the table
        </div>
      </div>
    </div>
  )
}
