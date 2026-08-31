import type { Hex } from '@hexfleet/shared'
import type { BoardView } from '../board/view.js'

type Props = {
  view: BoardView
  opacity?: number
  onCell?: (hex: Hex) => void
  onEnter?: (hex: Hex) => void
  onLeave?: () => void
  onDropCell?: (hex: Hex) => void
}

export function HexBoard({ view, opacity = 1, onCell, onEnter, onLeave, onDropCell }: Props) {
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      style={{ position: 'relative', width: view.width, height: view.height, flex: 'none', opacity }}
    >
      {view.hulls.map((h, i) => (
        <div
          key={i}
          style={{
            position: 'absolute', left: h.x, top: h.y, width: h.len, height: h.thick,
            borderRadius: 999, background: h.color, transform: `rotate(${h.rot}deg)`,
            transformOrigin: 'left center', opacity: h.opacity, pointerEvents: 'none',
          }}
        />
      ))}
      {view.cells.map((c) => (
        <div
          key={c.k}
          onClick={() => onCell?.(c.hex)}
          onMouseEnter={() => onEnter?.(c.hex)}
          onMouseLeave={() => onLeave?.()}
          onDragEnter={() => onEnter?.(c.hex)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            onDropCell?.(c.hex)
          }}
          style={{
            position: 'absolute', left: c.x, top: c.y, width: c.d, height: c.d,
            borderRadius: 999, background: c.bg, boxShadow: c.shadow, cursor: c.cursor,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
            gap: 1, padding: 3, transition: 'background 120ms ease, transform 120ms ease',
            transform: `scale(${c.scale})`,
          }}
        >
          {c.dots.map((d, i) => (
            <div key={i} style={{ width: d.size, height: d.size, borderRadius: 999, background: d.color }} />
          ))}
        </div>
      ))}
    </div>
  )
}
