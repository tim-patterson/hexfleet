import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PALETTE, SHIPS } from '@hexfleet/shared'
import type { PublicSeat, Snapshot } from '@hexfleet/shared'
import { Results, standingsOf } from './Results.js'

function seat(n: number, over: Partial<PublicSeat> = {}): PublicSeat {
  return {
    seat: n,
    name: `Captain ${n}`,
    color: PALETTE[n]!,
    ready: true,
    adrift: false,
    connected: true,
    ships: SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false })),
    shots: 0,
    hitsDealt: 0,
    ...over,
  }
}

function snapshot(seats: PublicSeat[], winner: number | null): Snapshot {
  return {
    type: 'snapshot', seq: 40, code: 'REEF-42', phase: 'results', boardRadius: 10,
    hostSeat: 0, mySeat: 0, seats, myFleet: null, shots: {}, turn: 0, turnDeadline: 0, winner,
  }
}

describe('standingsOf', () => {
  it('ranks by hulls left, then hits landed', () => {
    const a = seat(0, { shots: 10, hitsDealt: 3 })
    const b = seat(1, { shots: 10, hitsDealt: 7 })
    b.ships[0]!.sunk = true
    const rows = standingsOf(snapshot([a, b], 0))
    expect(rows.map((r) => r.seat)).toEqual([0, 1])
  })

  it('computes accuracy, and shows a dash for a captain who never fired', () => {
    const rows = standingsOf(snapshot([seat(0, { shots: 4, hitsDealt: 1 }), seat(1)], 0))
    expect(rows.find((r) => r.seat === 0)!.accuracy).toBe('25%')
    expect(rows.find((r) => r.seat === 1)!.accuracy).toBe('—')
  })

  it('notes a sunk fleet', () => {
    const dead = seat(1)
    dead.ships.forEach((s) => (s.sunk = true))
    const rows = standingsOf(snapshot([seat(0), dead], 0))
    expect(rows.find((r) => r.seat === 1)!.note).toBe('sunk')
    expect(rows.find((r) => r.seat === 1)!.left).toBe('0 / 5')
  })
})

describe('Results', () => {
  it('names the winner', () => {
    render(<Results snapshot={snapshot([seat(0), seat(1)], 1)} isHost={false} onRematch={() => {}} onLeave={() => {}} />)
    expect(screen.getByText('Captain 1 holds the sea.')).toBeTruthy()
  })

  it('addresses the viewer when they won', () => {
    render(<Results snapshot={snapshot([seat(0), seat(1)], 0)} isHost onRematch={() => {}} onLeave={() => {}} />)
    expect(screen.getByText('You hold the sea.')).toBeTruthy()
  })

  it('handles a table where nobody was left standing', () => {
    render(<Results snapshot={snapshot([seat(0), seat(1)], null)} isHost onRematch={() => {}} onLeave={() => {}} />)
    expect(screen.getByText('The sea takes them all.')).toBeTruthy()
  })

  it('offers a rematch only to the host', () => {
    const { rerender } = render(<Results snapshot={snapshot([seat(0)], 0)} isHost onRematch={() => {}} onLeave={() => {}} />)
    expect(screen.getByText('Play again')).toBeTruthy()
    rerender(<Results snapshot={snapshot([seat(0)], 0)} isHost={false} onRematch={() => {}} onLeave={() => {}} />)
    expect(screen.queryByText('Play again')).toBeNull()
  })

  it('calls the callbacks', () => {
    const onRematch = vi.fn()
    const onLeave = vi.fn()
    render(<Results snapshot={snapshot([seat(0)], 0)} isHost onRematch={onRematch} onLeave={onLeave} />)
    fireEvent.click(screen.getByText('Play again'))
    fireEvent.click(screen.getByText('Leave the table'))
    expect(onRematch).toHaveBeenCalled()
    expect(onLeave).toHaveBeenCalled()
  })

  it("totals the table's shots and hits", () => {
    render(<Results snapshot={snapshot([seat(0, { shots: 6, hitsDealt: 2 }), seat(1, { shots: 4, hitsDealt: 3 })], 0)} isHost onRematch={() => {}} onLeave={() => {}} />)
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
  })
})
