import { useState } from 'react'
import { GREEN, GREEN_TEXT, HEAD, MUTED, PAPER, SURFACE, ACCENT_DEEP } from '../theme.js'

type Props = {
  code: string | null
  muted: boolean
  onToggleSound: () => void
  onBrand: () => void
}

export function Header({ code, muted, onToggleSound, onBrand }: Props) {
  const [copied, setCopied] = useState(false)
  const fg = muted ? 'rgba(32,30,29,0.4)' : ACCENT_DEEP

  const copy = () => {
    if (!code) return
    const url = `${location.origin}${location.pathname}?table=${code}`
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).then(done, done)
    else done()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 17.6, padding: '17.6px 26.4px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 13.2 }}>
        <div onClick={onBrand} style={{ fontFamily: HEAD, fontSize: 25, letterSpacing: '-0.015em', cursor: 'pointer' }}>
          Hexfleet
        </div>
        <div style={{ fontSize: 13, color: MUTED }}>Six captains, one sea, three axes</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13.2, flexWrap: 'wrap' }}>
        <div className="soft" onClick={onToggleSound} style={{ display: 'flex', alignItems: 'center', gap: 8.8, padding: '7px 17.6px', borderRadius: 999, background: SURFACE, cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
            {[6, 11, 14].map((h) => (
              <div key={h} style={{ width: 3, height: h, borderRadius: 999, background: fg }} />
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: fg }}>{muted ? 'Sound off' : 'Sound on'}</div>
        </div>
        {code && (
          <div className="soft" onClick={copy} title="Copy a link to this table" style={{ display: 'flex', alignItems: 'center', gap: 8.8, padding: '6px 8px 6px 17.6px', borderRadius: 999, background: GREEN, cursor: 'pointer' }}>
            <div style={{ fontSize: 12.5, color: GREEN_TEXT }}>{copied ? 'Link copied' : 'Copy link'}</div>
            <div style={{ fontFamily: HEAD, fontSize: 15, letterSpacing: '0.06em', padding: '2px 13.2px', borderRadius: 999, background: PAPER }}>{code}</div>
          </div>
        )}
      </div>
    </div>
  )
}
