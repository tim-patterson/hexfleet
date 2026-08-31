import { useState } from 'react'
import { ACCENT, ACCENT_DEEP, ACCENT_PALE, BG, GREEN, GREEN_DARK, GREEN_TEXT, HEAD, MUTED, SURFACE } from '../theme.js'

type Props = {
  code: string
  color: string
  seatLabel: string
  onSubmit: (name: string) => void
  error: string | null
}

export function Name({ code, color, seatLabel, onSubmit, error }: Props) {
  const [name, setName] = useState('')
  const ready = name.trim().length > 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 22, padding: '44px 26.4px 52px', maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13.2, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: MUTED }}>You are joining table</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 13.2px 4px 17.6px', borderRadius: 999, background: GREEN }}>
          <div style={{ fontFamily: HEAD, fontSize: 16, letterSpacing: '0.08em' }}>{code}</div>
        </div>
      </div>
      <div style={{ fontFamily: HEAD, fontSize: 42, lineHeight: 1.12, letterSpacing: '-0.015em' }}>Who&rsquo;s at the helm?</div>
      <input
        value={name}
        placeholder="Your name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && ready && onSubmit(name.trim())}
        style={{ width: '100%', padding: '17.6px 26.4px', borderRadius: 999, border: 'none', background: SURFACE, fontSize: 20, boxShadow: error ? 'inset 0 0 0 2px #b2622d' : 'none' }}
      />
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13.2px 17.6px', borderRadius: 16, background: ACCENT_PALE, marginTop: -8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: '#b2622d', flex: 'none' }} />
          <div style={{ fontSize: 14, color: ACCENT_DEEP }}>{error}</div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 17.6, padding: '17.6px 22px', borderRadius: 28, background: GREEN }}>
        <div
          data-testid="seat-swatch"
          style={{ width: 46, height: 46, borderRadius: 999, flex: 'none', background: SURFACE, border: `2px dashed ${color}`, boxShadow: `0 0 0 4px ${BG}` }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: HEAD, fontSize: 17, color: GREEN_DARK }}>{seatLabel}</div>
          <div style={{ fontSize: 13, color: GREEN_TEXT }}>
            Colours are handed out with the seat, so no two captains clash. Every hit you take shows up in yours.
          </div>
        </div>
      </div>
      <div
        className="press"
        onClick={() => ready && onSubmit(name.trim())}
        style={{ alignSelf: 'flex-start', padding: '15px 44px', borderRadius: 999, background: ready ? ACCENT : SURFACE, color: ready ? BG : 'rgba(32,30,29,0.45)', fontFamily: HEAD, fontSize: 16, cursor: 'pointer' }}
      >
        {ready ? 'Take the helm' : 'Name yourself first'}
      </div>
    </div>
  )
}
