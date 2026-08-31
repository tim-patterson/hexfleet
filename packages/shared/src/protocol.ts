import type { Fleet, ShipId } from './ships.js'
import type { ShipStatus, ShotMap } from './rules.js'

export const PALETTE = ['#c67139', '#7a8a5e', '#4f8a86', '#96517a', '#d9a441', '#5a6f9e'] as const
export const MAX_SEATS = 6
export const MIN_SEATS = 2
export const TURN_MS = 30_000
export const ADRIFT_AFTER = 3
export const IDLE_EVICT_MS = 86_400_000

export const CODE_RE = /^[A-Z]{4}-\d{2}$/
export function isTableCode(s: string): boolean {
  return CODE_RE.test(s)
}

export type Phase = 'lobby' | 'battle' | 'results'

export type PublicSeat = {
  seat: number
  name: string
  color: string
  ready: boolean
  adrift: boolean
  connected: boolean
  ships: ShipStatus[]
  shots: number
  hitsDealt: number
}

export type Snapshot = {
  type: 'snapshot'
  seq: number
  code: string
  phase: Phase
  boardRadius: number
  hostSeat: number
  mySeat: number
  seats: PublicSeat[]
  /** Only ever the receiving seat's own fleet. */
  myFleet: Fleet | null
  shots: ShotMap
  turn: number
  /** Epoch ms; 0 outside the battle phase. */
  turnDeadline: number
  winner: number | null
}

export type GameEvent =
  | { type: 'seatJoined'; seq: number; seat: PublicSeat }
  | { type: 'seatLeft'; seq: number; seat: number }
  | { type: 'seatReady'; seq: number; seat: number }
  | { type: 'seatUnready'; seq: number; seat: number }
  | { type: 'battleStarted'; seq: number; turn: number; turnDeadline: number }
  | {
      type: 'shotFired'
      seq: number
      seat: number
      q: number
      r: number
      hits: number[]
      sunk: { seat: number; shipId: ShipId }[]
    }
  | { type: 'turnAdvanced'; seq: number; turn: number; turnDeadline: number }
  | { type: 'seatAdrift'; seq: number; seat: number }
  | { type: 'seatReturned'; seq: number; seat: number }
  | { type: 'gameEnded'; seq: number; winner: number | null }
  | { type: 'rematchStarted'; seq: number }

export type Welcome = { type: 'welcome'; token: string; seat: number }
export type ErrorMsg = { type: 'error'; code: string; message: string }

export type ServerMsg = Snapshot | GameEvent | Welcome | ErrorMsg

export type ClientMsg =
  | { type: 'hello'; token?: string; name?: string }
  | { type: 'lockFleet'; fleet: Fleet }
  | { type: 'unlockFleet' }
  | { type: 'startBattle' }
  | { type: 'fire'; q: number; r: number }
  | { type: 'rematch' }
  | { type: 'resync' }

/** Every message the server sends that carries a sequence number. */
export function isSequenced(msg: ServerMsg): msg is GameEvent | Snapshot {
  return msg.type !== 'welcome' && msg.type !== 'error'
}
