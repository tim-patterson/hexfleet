import type { Fleet, Phase, ShotMap } from '@hexfleet/shared'

export type Seat = {
  seat: number
  name: string
  /** SHA-256 of the seat token. The raw token is never stored. */
  tokenHash: string
  ready: boolean
  adrift: boolean
  /** Consecutive turn-clock expiries. */
  timeouts: number
  connected: boolean
}

export type TableState = {
  code: string
  phase: Phase
  hostSeat: number
  seats: Seat[]
  /** SECRET — never leaves the Durable Object except to its owner. */
  fleets: Record<number, Fleet>
  shots: ShotMap
  turn: number
  turnDeadline: number
  seq: number
  winner: number | null
  createdAt: number
  lastActivityAt: number
}

export function freshState(code: string, now: number): TableState {
  return {
    code,
    phase: 'lobby',
    hostSeat: 0,
    seats: [],
    fleets: {},
    shots: {},
    turn: 0,
    turnDeadline: 0,
    seq: 0,
    winner: null,
    createdAt: now,
    lastActivityAt: now,
  }
}

export async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
