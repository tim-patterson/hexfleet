import { applyEvent } from '@hexfleet/shared'
import type { GameEvent, ServerMsg, Snapshot } from '@hexfleet/shared'

export type Session = {
  snapshot: Snapshot | null
  token: string | null
  seat: number | null
  error: { code: string; message: string } | null
  /** Set when a sequence gap is seen; the socket layer answers with `resync`. */
  needsResync: boolean
}

export function initialSession(): Session {
  return { snapshot: null, token: null, seat: null, error: null, needsResync: false }
}

const EVENT_TYPES = new Set([
  'seatJoined',
  'seatLeft',
  'seatReady',
  'seatUnready',
  'battleStarted',
  'shotFired',
  'turnAdvanced',
  'seatAdrift',
  'seatReturned',
  'gameEnded',
  'rematchStarted',
])

/** Pure: folds one server message into the session. Never mutates `s`. */
export function receive(s: Session, msg: ServerMsg): Session {
  if (msg.type === 'welcome') {
    return { ...s, token: msg.token, seat: msg.seat, error: null }
  }

  if (msg.type === 'error') {
    return { ...s, error: { code: msg.code, message: msg.message } }
  }

  if (msg.type === 'snapshot') {
    return { ...s, snapshot: msg, needsResync: false, error: null }
  }

  if (!EVENT_TYPES.has(msg.type)) return s

  const ev = msg as GameEvent
  if (!s.snapshot) return { ...s, needsResync: true }

  // Already applied -- a harmless replay after a reconnect.
  if (ev.seq <= s.snapshot.seq) return s

  // Anything other than the very next seq means we missed something: stop
  // applying and wait for the socket layer to fetch a fresh snapshot.
  if (ev.seq !== s.snapshot.seq + 1) return { ...s, needsResync: true }

  return { ...s, snapshot: applyEvent(s.snapshot, ev), error: null }
}
