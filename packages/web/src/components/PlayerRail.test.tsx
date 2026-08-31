import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PALETTE, SHIPS } from '@hexfleet/shared'
import type { PublicSeat } from '@hexfleet/shared'
import { PlayerRail } from './PlayerRail.js'

function seat(n: number, over: Partial<PublicSeat> = {}): PublicSeat {
  return {
    seat: n,
    name: `Captain ${n}`,
    color: PALETTE[n]!,
    ready: false,
    adrift: false,
    connected: true,
    ships: SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false })),
    shots: 0,
    hitsDealt: 0,
    ...over,
  }
}

describe('PlayerRail', () => {
  it("marks the viewer's own row", () => {
    render(<PlayerRail seats={[seat(0), seat(1)]} mySeat={0} phase="lobby" turn={0} title="At the table" timer={null} />)
    expect(screen.getByText('Captain 0 (you)')).toBeTruthy()
    expect(screen.getByText('Captain 1')).toBeTruthy()
  })

  it('shows ready state in the lobby', () => {
    render(<PlayerRail seats={[seat(0, { ready: true }), seat(1)]} mySeat={0} phase="lobby" turn={0} title="At the table" timer={null} />)
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Still placing…')).toBeTruthy()
  })

  it('counts hulls afloat during battle', () => {
    const damaged = seat(1)
    damaged.ships[0]!.sunk = true
    render(<PlayerRail seats={[seat(0), damaged]} mySeat={0} phase="battle" turn={0} title="Turn order" timer="0:27" />)
    expect(screen.getByText('5 of 5 afloat')).toBeTruthy()
    expect(screen.getByText('4 of 5 afloat')).toBeTruthy()
  })

  it('shows a destroyed fleet', () => {
    const dead = seat(1)
    dead.ships.forEach((s) => (s.sunk = true))
    render(<PlayerRail seats={[seat(0), dead]} mySeat={0} phase="battle" turn={0} title="Turn order" timer="0:27" />)
    expect(screen.getByText('Fleet destroyed')).toBeTruthy()
  })

  it('flags an adrift captain', () => {
    render(<PlayerRail seats={[seat(0), seat(1, { adrift: true })]} mySeat={0} phase="battle" turn={0} title="Turn order" timer="0:27" />)
    expect(screen.getByText(/adrift/i)).toBeTruthy()
  })

  it('renders the clock only when one is supplied', () => {
    const { rerender } = render(<PlayerRail seats={[seat(0)]} mySeat={0} phase="battle" turn={0} title="Turn order" timer="0:09" />)
    expect(screen.getByText('0:09')).toBeTruthy()
    rerender(<PlayerRail seats={[seat(0)]} mySeat={0} phase="lobby" turn={0} title="At the table" timer={null} />)
    expect(screen.queryByText('0:09')).toBeNull()
  })
})
