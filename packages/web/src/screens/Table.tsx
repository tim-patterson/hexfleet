import { useEffect, useMemo, useRef, useState } from 'react'
import { MIN_SEATS, SHIPS } from '@hexfleet/shared'
import type { Fleet } from '@hexfleet/shared'
import { useTable } from '../net/useTable.js'
import { useDeployment } from '../board/useDeployment.js'
import { buildBoard } from '../board/view.js'
import { HexBoard } from '../components/HexBoard.js'
import { PlayerRail } from '../components/PlayerRail.js'
import { ShipTray } from '../components/ShipTray.js'
import { AxisPicker } from '../components/AxisPicker.js'
import { FleetStatus } from '../components/FleetStatus.js'
import { Results } from './Results.js'
import { sfx } from '../audio.js'
import { ACCENT, ACCENT_DEEP, ACCENT_PALE, BG, FAINT, GREEN, GREEN_DARK, GREEN_TEXT, HEAD, MUTED, SURFACE } from '../theme.js'

// Every hook runs before any early return — React requires a stable hook
// order, so the "connecting" and "results" branches come after them.
export function Table({ code, name, onLeave }: { code: string; name: string; onLeave: () => void }) {
  const table = useTable(code, name)
  const snap = table.snapshot
  const radius = snap?.boardRadius ?? 10
  const deploy = useDeployment(radius)
  const [now, setNow] = useState(Date.now())
  const prevShots = useRef(0)
  const wasResults = useRef(false)

  const me = snap?.seats.find((s) => s.seat === snap.mySeat) ?? null
  const myColor = me?.color ?? ACCENT
  const isDeploy = snap?.phase === 'lobby' && !me?.ready
  const isWaiting = snap?.phase === 'lobby' && !!me?.ready
  const isBattle = snap?.phase === 'battle'
  const myTurn = !!snap && isBattle && snap.turn === snap.mySeat

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  // Sound follows the shot map rather than individual events, so a resync
  // after a dropped connection replays no barrage.
  useEffect(() => {
    if (!snap) return
    const count = Object.keys(snap.shots).length
    if (count > prevShots.current && prevShots.current > 0) {
      const last = Object.values(snap.shots).at(-1)
      sfx.play(last && last.hits.length > 0 ? 'boom' : 'splash')
    }
    prevShots.current = count
  }, [snap])

  useEffect(() => {
    if (snap?.phase === 'results' && !wasResults.current) {
      wasResults.current = true
      sfx.play('win')
    }
    if (snap?.phase !== 'results') wasResults.current = false
  }, [snap?.phase])

  const view = useMemo(() => {
    if (!snap) return null
    return buildBoard({
      radius,
      mode: isDeploy ? 'deploy' : isWaiting ? 'waiting' : 'battle',
      myFleet: isDeploy ? (deploy.placement as Fleet) : snap.myFleet,
      mySeat: snap.mySeat,
      myColor,
      shots: snap.shots,
      seatColors: Object.fromEntries(snap.seats.map((s) => [s.seat, s.color])),
      hover: isDeploy || isBattle ? deploy.hover : null,
      preview: isDeploy ? deploy.preview : null,
      sunkShips: new Set((me?.ships ?? []).filter((s) => s.sunk).map((s) => s.shipId)),
    })
  }, [radius, isDeploy, isWaiting, isBattle, deploy.placement, deploy.hover, deploy.preview, snap, me, myColor])

  if (!snap || !view) {
    return (
      <div style={{ flex: 1, padding: '44px 26.4px', fontFamily: HEAD, fontSize: 25 }}>
        {table.status === 'closed' ? 'Reconnecting to the table…' : 'Rowing out to the table…'}
      </div>
    )
  }

  if (snap.phase === 'results') {
    return (
      <Results
        snapshot={snap}
        isHost={snap.mySeat === snap.hostSeat}
        onRematch={() => table.send({ type: 'rematch' })}
        onLeave={onLeave}
      />
    )
  }

  const readyCount = snap.seats.filter((s) => s.ready).length
  const secondsLeft = Math.max(0, Math.ceil((snap.turnDeadline - now) / 1000))
  const timer = isBattle ? `0:${String(Math.min(99, secondsLeft)).padStart(2, '0')}` : null
  const turnName = snap.seats.find((s) => s.seat === snap.turn)?.name ?? 'Someone'

  return (
    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 26.4, padding: '8.8px 26.4px 35.2px' }}>
      <PlayerRail
        seats={snap.seats}
        mySeat={snap.mySeat}
        phase={snap.phase}
        turn={snap.turn}
        title={isBattle ? 'Turn order' : isWaiting ? 'The table' : 'At the table'}
        timer={timer}
      />

      <div style={{ flex: '2 1 620px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 17.6 }}>
        <div style={{ width: '100%', maxWidth: view.width + 54, padding: 26.4, borderRadius: 28, background: GREEN, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 17.6, overflowX: 'auto' }}>
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'baseline', gap: 13.2, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: HEAD, fontSize: 20, color: GREEN_DARK }}>The Sea</div>
            <div style={{ fontSize: 13, color: GREEN_TEXT }}>
              {isDeploy
                ? `${deploy.placedCount} of ${SHIPS.length} hulls at sea — everyone shares these waters`
                : isWaiting
                  ? 'Locked in. Waiting on the rest of the table.'
                  : myTurn
                    ? 'Pick a hex to fire on'
                    : `${turnName} is taking aim…`}
            </div>
          </div>
          <HexBoard
            view={view}
            opacity={isWaiting ? 0.72 : 1}
            onEnter={(h) => (isDeploy || isBattle) && deploy.setHover(h)}
            onLeave={() => deploy.setHover(null)}
            onDropCell={(h) => isDeploy && deploy.dropAt(h) && sfx.play('place')}
            onCell={(h) => {
              if (isDeploy) {
                if (deploy.rotateAt(h)) return
                if (deploy.dropAt(h)) sfx.play('place')
              } else if (isBattle && myTurn) {
                table.send({ type: 'fire', q: h.q, r: h.r })
              }
            }}
          />
        </div>
      </div>

      <div style={{ width: 300, flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 13.2 }}>
        {isDeploy && (
          <>
            <div style={{ fontFamily: HEAD, fontSize: 20 }}>Your yard</div>
            <div style={{ fontSize: 13.5, color: MUTED, marginTop: -8 }}>
              Drag a hull onto the sea. Click a placed hull to spin it through the three axes.
            </div>
            <AxisPicker axis={deploy.axis} onChange={deploy.setAxis} />
            <ShipTray
              placement={deploy.placement}
              selected={deploy.selected}
              color={myColor}
              onSelect={deploy.select}
              onDragStart={(id) => {
                deploy.setDragging(id)
                deploy.select(id)
              }}
              onDragEnd={() => deploy.setDragging(null)}
            />
            <div style={{ display: 'flex', gap: 8.8, marginTop: 4.4 }}>
              <div className="press" onClick={deploy.scatter} style={{ flex: 1, textAlign: 'center', padding: '11px 0', borderRadius: 999, background: SURFACE, fontFamily: HEAD, fontSize: 14, cursor: 'pointer' }}>Scatter</div>
              <div className="press" onClick={deploy.clear} style={{ flex: 1, textAlign: 'center', padding: '11px 0', borderRadius: 999, background: SURFACE, fontFamily: HEAD, fontSize: 14, cursor: 'pointer' }}>Clear</div>
            </div>
            <div
              className="press"
              onClick={() => deploy.complete && table.send({ type: 'lockFleet', fleet: deploy.complete })}
              style={{ textAlign: 'center', padding: '15px 0', borderRadius: 999, background: deploy.complete ? ACCENT : SURFACE, color: deploy.complete ? BG : 'rgba(32,30,29,0.45)', fontFamily: HEAD, fontSize: 16, cursor: 'pointer' }}
            >
              {deploy.complete ? 'Ready — lock my fleet' : `Place all ${SHIPS.length} hulls`}
            </div>
            {table.error && <div style={{ fontSize: 13, color: ACCENT_DEEP }}>{table.error.message}</div>}
          </>
        )}

        {isWaiting && (
          <>
            <div style={{ fontFamily: HEAD, fontSize: 20 }}>Hold position</div>
            <div style={{ padding: 26.4, borderRadius: 28, background: SURFACE, display: 'flex', flexDirection: 'column', gap: 13.2 }}>
              <div style={{ fontFamily: HEAD, fontSize: 42, lineHeight: 1, color: ACCENT_DEEP }}>
                {readyCount} / {snap.seats.length}
              </div>
              <div style={{ fontSize: 14, color: MUTED }}>
                captains have their hulls in the water. The first salvo fires when the table is set.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4.4 }}>
                {snap.seats.map((s, i) => (
                  <div key={s.seat} style={{ width: 14, height: 14, borderRadius: 999, background: s.ready ? s.color : FAINT, animation: 'bob 1.6s ease-in-out infinite', animationDelay: `${i * 0.16}s` }} />
                ))}
              </div>
            </div>
            {snap.mySeat === snap.hostSeat && (
              <div
                className="press"
                onClick={() => readyCount >= MIN_SEATS && table.send({ type: 'startBattle' })}
                style={{ textAlign: 'center', padding: '15px 0', borderRadius: 999, background: readyCount >= MIN_SEATS ? ACCENT : SURFACE, color: readyCount >= MIN_SEATS ? BG : 'rgba(32,30,29,0.45)', fontFamily: HEAD, fontSize: 16, cursor: 'pointer' }}
              >
                {readyCount >= MIN_SEATS ? 'Fire the first salvo' : `Waiting for ${MIN_SEATS} captains`}
              </div>
            )}
            <div className="press" onClick={() => table.send({ type: 'unlockFleet' })} style={{ textAlign: 'center', padding: '11px 0', borderRadius: 999, background: SURFACE, fontFamily: HEAD, fontSize: 14, cursor: 'pointer' }}>
              Change my placement
            </div>
          </>
        )}

        {isBattle && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8.8 }}>
              <div style={{ width: 14, height: 14, borderRadius: 999, background: myColor }} />
              <div style={{ fontFamily: HEAD, fontSize: 20 }}>Your fleet</div>
            </div>
            <FleetStatus ships={me?.ships ?? []} color={myColor} />
            <div style={{ padding: 17.6, borderRadius: 28, background: SURFACE, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12.5, color: MUTED }}>This salvo</div>
              <div style={{ fontFamily: HEAD, fontSize: 18, color: ACCENT_DEEP }}>
                {myTurn ? 'Your shot' : `${turnName} is taking aim…`}
              </div>
            </div>
            {table.error && <div style={{ fontSize: 13, color: ACCENT_DEEP }}>{table.error.message}</div>}
          </>
        )}
      </div>
    </div>
  )
}
