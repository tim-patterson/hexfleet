import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cellsFor, PALETTE, SHIPS } from '@hexfleet/shared'
import type { Fleet, PublicSeat, Snapshot } from '@hexfleet/shared'

function fleet(): Fleet {
  return {
    carrier: cellsFor({ q: -2, r: 0 }, 0, 5),
    cutter: cellsFor({ q: -2, r: 1 }, 0, 4),
    trawler: cellsFor({ q: -2, r: 2 }, 0, 3),
    skiff: cellsFor({ q: -2, r: -1 }, 0, 3),
    tug: cellsFor({ q: -2, r: -2 }, 0, 2),
  }
}

function seat(over: Partial<PublicSeat> = {}): PublicSeat {
  return {
    seat: 0,
    name: 'Captain 0',
    color: PALETTE[0]!,
    ready: false,
    adrift: false,
    connected: true,
    ships: SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false })),
    shots: 0,
    hitsDealt: 0,
    ...over,
  }
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    type: 'snapshot',
    seq: 1,
    code: 'ABCD-01',
    phase: 'lobby',
    boardRadius: 4,
    hostSeat: 0,
    mySeat: 0,
    seats: [seat()],
    myFleet: fleet(),
    shots: {},
    turn: 0,
    turnDeadline: 0,
    winner: null,
    ...over,
  }
}

let mockSnapshot: Snapshot | null = null

vi.mock('../net/useTable.js', () => ({
  useTable: () => ({
    status: 'open' as const,
    snapshot: mockSnapshot,
    seat: mockSnapshot?.mySeat ?? null,
    error: null,
    send: vi.fn(),
  }),
}))

const playSpy = vi.fn()
vi.mock('../audio.js', () => ({
  sfx: { play: (...args: unknown[]) => playSpy(...args), setMuted: vi.fn() },
}))

// Import after the mocks so Table.tsx picks up the mocked useTable/sfx.
const { Table } = await import('./Table.js')

describe('Table', () => {
  beforeEach(() => {
    playSpy.mockClear()
  })

  it('does not play the win fanfare when the first snapshot already shows results', () => {
    // Loading straight into an already-finished table (a reload, or a
    // link opened after the fact) must not replay the victory sound --
    // only an actual phase transition into results should.
    mockSnapshot = snapshot({ phase: 'results', winner: 0, turnDeadline: 0 })
    render(<Table code="ABCD-01" name="Captain 0" onLeave={() => {}} />)
    expect(playSpy).not.toHaveBeenCalledWith('win')
  })

  it('seeds the deploy yard from a server-held fleet on reload, instead of showing it empty', () => {
    // A seat that is not ready is in deploy mode, but the server may still
    // be holding a previously-locked fleet (e.g. after unlockFleet, or a
    // reload that lands mid-edit). The yard must reflect that fleet, not
    // start empty.
    mockSnapshot = snapshot({ seats: [seat({ ready: false })], myFleet: fleet() })
    render(<Table code="ABCD-01" name="Captain 0" onLeave={() => {}} />)

    // ShipTray marks a hull "At sea" once it appears in the local
    // placement; all five must show that, seeded from snap.myFleet. The
    // status text shares a row with "· N hexes", so match by prefix.
    expect(screen.getAllByText(/^At sea/)).toHaveLength(SHIPS.length)
    expect(screen.queryByText(/^In the yard/)).toBeNull()
  })
})
