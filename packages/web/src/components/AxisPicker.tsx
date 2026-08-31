import { ACCENT_DEEP, ACCENT_PALE, MUTED, SURFACE } from '../theme.js'

const LABELS = ['E–W', 'NW–SE', 'NE–SW']
const ROTATIONS = [0, 60, -60]

export function AxisPicker({ axis, onChange }: { axis: number; onChange: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8.8 }}>
      {LABELS.map((label, i) => {
        const on = axis === i
        const fg = on ? ACCENT_DEEP : MUTED
        return (
          <div
            key={label}
            onClick={() => onChange(i)}
            style={{ flex: 1, padding: '13.2px 0', borderRadius: 16, background: on ? ACCENT_PALE : SURFACE, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <div style={{ width: 36, height: 6, borderRadius: 999, background: fg, transform: `rotate(${ROTATIONS[i]}deg)` }} />
            <div style={{ fontSize: 11.5, fontWeight: 600, color: fg }}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}
