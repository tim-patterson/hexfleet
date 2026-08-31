import { useState } from 'react'
import { isTableCode, PALETTE } from '@hexfleet/shared'
import { ACCENT, ACCENT_DEEP, ACCENT_PALE, BG, GREEN, GREEN_DEEP, GREEN_TEXT, GREEN_DARK, HEAD, MUTED, PAPER, SHADOW_MD, SURFACE } from '../theme.js'

type Props = {
  onJoin: (code: string) => void
  onCreate: () => void
  busy: boolean
  error: string | null
}

export function Landing({ onJoin, onCreate, busy, error }: Props) {
  const [code, setCode] = useState('')
  const [format, setFormat] = useState(false)
  const shown = error ?? (format ? 'Table codes are four letters, a dash, then two digits.' : null)

  const submit = () => {
    const raw = code.trim().toUpperCase()
    if (!isTableCode(raw)) {
      setFormat(true)
      return
    }
    setFormat(false)
    onJoin(raw)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 35.2, padding: '35.2px 26.4px 52px', maxWidth: 1120 }}>
      <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 17.6 }}>
        <div style={{ fontFamily: HEAD, fontSize: 42, lineHeight: 1.12, letterSpacing: '-0.015em', maxWidth: '12ch' }}>
          Take the sea from five other captains.
        </div>
        <div style={{ fontSize: 16, maxWidth: '44ch' }}>
          One shared hex sea. Hulls run along three axes instead of two, every captain flies a colour, and a single hex
          can hold more than one fleet.
        </div>
        <div style={{ display: 'flex', gap: 13.2, alignItems: 'center', marginTop: 8.8 }}>
          {PALETTE.map((c, i) => (
            <div
              key={c}
              data-testid="palette-dot"
              style={{ width: 34, height: 34, borderRadius: 999, background: c, animation: 'bob 2.4s ease-in-out infinite', animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 17.6, maxWidth: 420 }}>
        <div style={{ padding: 26.4, borderRadius: 28, background: SURFACE, boxShadow: SHADOW_MD, display: 'flex', flexDirection: 'column', gap: 13.2 }}>
          <div style={{ fontFamily: HEAD, fontSize: 25 }}>Join a table</div>
          <div style={{ fontSize: 13.5, color: MUTED, marginTop: -8 }}>Ask whoever set the table for its code.</div>
          <input
            value={code}
            placeholder="REEF-42"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setFormat(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={{
              width: '100%', padding: '13.2px 22px', borderRadius: 999, border: 'none', background: PAPER,
              fontFamily: HEAD, fontSize: 20, letterSpacing: '0.1em', textTransform: 'uppercase',
              boxShadow: shown ? 'inset 0 0 0 2px #b2622d' : 'none',
            }}
          />
          {shown && (
            <div style={{ display: 'flex', gap: 11, padding: '13.2px 17.6px', borderRadius: 16, background: ACCENT_PALE }}>
              <div style={{ width: 10, height: 10, borderRadius: 999, background: '#b2622d', flex: 'none', marginTop: 6 }} />
              <div style={{ fontSize: 13.5, color: ACCENT_DEEP }}>{shown}</div>
            </div>
          )}
          <div style={{ fontSize: 12.5, color: MUTED }}>Codes look like REEF-42 — four letters, two digits.</div>
          <div className="press" onClick={submit} style={{ textAlign: 'center', padding: '15px 0', borderRadius: 999, background: ACCENT, color: BG, fontFamily: HEAD, fontSize: 16, cursor: 'pointer' }}>
            Join the table
          </div>
        </div>

        <div style={{ padding: 26.4, borderRadius: 28, background: GREEN, display: 'flex', flexDirection: 'column', gap: 13.2 }}>
          <div style={{ fontFamily: HEAD, fontSize: 25, color: GREEN_DARK }}>Set a new table</div>
          <div style={{ fontSize: 13.5, color: GREEN_TEXT, marginTop: -8 }}>We hand you a code to pass around. Up to six captains.</div>
          <div className="press" onClick={() => !busy && onCreate()} style={{ textAlign: 'center', padding: '15px 0', borderRadius: 999, background: GREEN_DEEP, color: BG, fontFamily: HEAD, fontSize: 16, cursor: busy ? 'progress' : 'pointer' }}>
            {busy ? 'Setting a table…' : 'Launch a table'}
          </div>
        </div>
      </div>
    </div>
  )
}
