import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardView, CellView, HullView } from '../board/view.js'
import { HexBoard } from './HexBoard.js'

function cell(over: Partial<CellView> = {}): CellView {
  return {
    k: '0,0',
    hex: { q: 0, r: 0 },
    x: 0,
    y: 0,
    d: 20,
    bg: '#f5ead8',
    shadow: 'none',
    dots: [],
    scale: 1,
    cursor: 'pointer',
    ...over,
  }
}

function hull(over: Partial<HullView> = {}): HullView {
  return { x: 0, y: 0, len: 40, thick: 14, rot: 0, color: '#c67139', opacity: 1, ...over }
}

function view(over: Partial<BoardView> = {}): BoardView {
  return {
    cells: [cell({ k: '0,0', hex: { q: 0, r: 0 } }), cell({ k: '1,0', hex: { q: 1, r: 0 } })],
    hulls: [hull()],
    width: 200,
    height: 200,
    ...over,
  }
}

// Hull bars are pointer-events:none decoration; cells are the only
// elements that carry a cursor style, so the two are distinguishable
// without any test-only markup on the component itself.
function cellEls(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('div[style*="cursor"]')
}
function hullEls(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('div[style*="pointer-events: none"]')
}

describe('HexBoard', () => {
  it('renders one element per cell and one bar per hull', () => {
    const v = view({ hulls: [hull(), hull()] })
    const { container } = render(<HexBoard view={v} />)
    expect(cellEls(container)).toHaveLength(2)
    expect(hullEls(container)).toHaveLength(2)
  })

  it('invokes onCell with the clicked hex', () => {
    const onCell = vi.fn()
    const { container } = render(<HexBoard view={view()} onCell={onCell} />)
    fireEvent.click(cellEls(container)[1]!)
    expect(onCell).toHaveBeenCalledWith({ q: 1, r: 0 })
  })

  it('invokes onDropCell when a hull is dropped on a cell', () => {
    const onDropCell = vi.fn()
    const { container } = render(<HexBoard view={view()} onDropCell={onDropCell} />)
    fireEvent.drop(cellEls(container)[0]!)
    expect(onDropCell).toHaveBeenCalledWith({ q: 0, r: 0 })
  })

  it('does nothing when onCell/onDropCell are not supplied', () => {
    const { container } = render(<HexBoard view={view()} />)
    const cells = cellEls(container)
    expect(() => fireEvent.click(cells[0]!)).not.toThrow()
    expect(() => fireEvent.drop(cells[0]!)).not.toThrow()
  })
})
