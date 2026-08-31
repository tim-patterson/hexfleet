import { useEffect, useState } from 'react'
import { isTableCode } from '@hexfleet/shared'
import { createTable } from './api.js'
import { Header } from './components/Header.js'
import { Landing } from './screens/Landing.js'
import { Name } from './screens/Name.js'
import { Table } from './screens/Table.js'
import { sfx } from './audio.js'
import { BG, BODY, INK, seatColor } from './theme.js'

type Route = { at: 'landing' } | { at: 'name'; code: string } | { at: 'table'; code: string; name: string }

export function App() {
  const [route, setRoute] = useState<Route>(() => {
    const fromLink = new URLSearchParams(location.search).get('table')?.toUpperCase()
    return fromLink && isTableCode(fromLink) ? { at: 'name', code: fromLink } : { at: 'landing' }
  })
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => sfx.setMuted(muted), [muted])

  const create = async () => {
    setBusy(true)
    setJoinError(null)
    try {
      setRoute({ at: 'name', code: await createTable() })
    } catch {
      setJoinError('Could not reach the harbourmaster. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, color: INK, fontFamily: BODY, fontSize: 15, lineHeight: 1.55, display: 'flex', flexDirection: 'column' }}>
      <Header
        code={route.at === 'landing' ? null : route.code}
        muted={muted}
        onToggleSound={() => {
          const next = !muted
          setMuted(next)
          if (!next) sfx.play('place')
        }}
        onBrand={() => setRoute({ at: 'landing' })}
      />
      {route.at === 'landing' && <Landing onJoin={(code) => setRoute({ at: 'name', code })} onCreate={create} busy={busy} error={joinError} />}
      {route.at === 'name' && (
        <Name
          code={route.code}
          color={seatColor(0)}
          seatLabel="Your colour is handed out with your seat"
          error={null}
          onSubmit={(name) => setRoute({ at: 'table', code: route.code, name })}
        />
      )}
      {route.at === 'table' && <Table code={route.code} name={route.name} onLeave={() => setRoute({ at: 'landing' })} />}
    </div>
  )
}
