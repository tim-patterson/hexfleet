import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PALETTE, SHIPS } from '@hexfleet/shared'
import type { PublicSeat, Snapshot } from '@hexfleet/shared'
import { tokenKey, useTable } from './useTable.js'

type Listener = (e: { data?: string }) => void

/** A hand-driven stand-in for the browser WebSocket, just enough of the API
 * for useTable: addEventListener/send/close plus test helpers to fire
 * open/message/close from "the server" side. */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState: number = FakeWebSocket.CONNECTING
  readonly url: string
  readonly sent: string[] = []
  private readonly listeners: Record<'open' | 'message' | 'close' | 'error', Listener[]> = {
    open: [],
    message: [],
    close: [],
    error: [],
  }

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', cb: Listener): void {
    this.listeners[type].push(cb)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    for (const cb of this.listeners.close.slice()) cb({})
  }

  /** Simulate the server accepting the connection. */
  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    for (const cb of this.listeners.open.slice()) cb({})
  }

  /** Simulate a JSON message arriving from the server. */
  serverMessage(msg: unknown): void {
    for (const cb of this.listeners.message.slice()) cb({ data: JSON.stringify(msg) })
  }

  sentMessages(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown)
  }
}

/** Installs a fake `WebSocket` global and returns the list of sockets it
 * creates, in construction order, so a test can drive each one by hand. */
function installFakeWebSocket(): FakeWebSocket[] {
  const created: FakeWebSocket[] = []
  class TrackedFakeWebSocket extends FakeWebSocket {
    constructor(url: string) {
      super(url)
      created.push(this)
    }
  }
  vi.stubGlobal('WebSocket', TrackedFakeWebSocket)
  return created
}

/** A minimal in-memory `Storage`. Node 22+ ships its own global
 * `localStorage` (behind `--experimental-webstorage`, on by default in
 * newer Node without a `--localstorage-file`), and it leaks straight
 * through jsdom's `window` non-functional -- every method on it is
 * `undefined`. Stub the global with a real implementation for these tests
 * rather than relying on whatever the host Node version does. */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

/** A `Storage` whose read and write both throw, simulating private
 * browsing / blocked storage. */
function createThrowingStorage(): Storage {
  const boom = () => {
    throw new Error('blocked')
  }
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    length: 0,
  } as unknown as Storage
}

function seat(n: number): PublicSeat {
  return {
    seat: n,
    name: `C${n}`,
    color: PALETTE[n]!,
    ready: false,
    adrift: false,
    connected: true,
    ships: SHIPS.map((s) => ({ shipId: s.id, len: s.len, hits: 0, sunk: false })),
    shots: 0,
    hitsDealt: 0,
  }
}

function makeSnapshot(seq: number, code = 'REEF-42'): Snapshot {
  return {
    type: 'snapshot',
    seq,
    code,
    phase: 'lobby',
    boardRadius: 10,
    hostSeat: 0,
    mySeat: 0,
    seats: [seat(0), seat(1)],
    myFleet: null,
    shots: {},
    turn: 0,
    turnDeadline: 0,
    winner: null,
  }
}

describe('useTable', () => {
  let created: FakeWebSocket[]

  beforeEach(() => {
    created = installFakeWebSocket()
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends hello carrying a token previously stored under hexfleet:seat:<code>', () => {
    localStorage.setItem(tokenKey('REEF-42'), 'tok-123')

    const { result, unmount } = renderHook(() => useTable('REEF-42', 'Ann'))
    expect(created).toHaveLength(1)

    act(() => created[0]!.serverOpen())

    expect(result.current.status).toBe('open')
    expect(created[0]!.sentMessages()).toEqual([{ type: 'hello', token: 'tok-123', name: 'Ann' }])

    unmount()
  })

  it('applies a sequenced event, and a gapped event triggers exactly one resync', () => {
    const { result, unmount } = renderHook(() => useTable('REEF-42', 'Ann'))
    const ws = created[0]!
    act(() => ws.serverOpen())

    const snapshot = makeSnapshot(5)
    act(() => ws.serverMessage(snapshot))
    expect(result.current.snapshot).toEqual(snapshot)

    // In order: seq 6 follows seq 5 directly.
    act(() => ws.serverMessage({ type: 'seatReady', seq: 6, seat: 1 }))
    expect(result.current.snapshot!.seats[1]!.ready).toBe(true)
    expect(result.current.snapshot!.seq).toBe(6)
    expect(ws.sentMessages().filter((m) => (m as { type: string }).type === 'resync')).toHaveLength(
      0,
    )

    // Gapped: jumps straight to seq 20, skipping 7..19.
    act(() => ws.serverMessage({ type: 'seatReady', seq: 20, seat: 1 }))
    const resyncsAfterFirstGap = ws
      .sentMessages()
      .filter((m) => (m as { type: string }).type === 'resync')
    expect(resyncsAfterFirstGap).toHaveLength(1)
    expect(result.current.snapshot!.seq).toBe(6) // not applied

    // Still gapped: another out-of-order event must not trigger a second resync.
    act(() => ws.serverMessage({ type: 'seatReady', seq: 21, seat: 1 }))
    const resyncsAfterSecondGap = ws
      .sentMessages()
      .filter((m) => (m as { type: string }).type === 'resync')
    expect(resyncsAfterSecondGap).toHaveLength(1)

    unmount()
  })

  it('does not let a message from a stale socket reach the session for a new code', () => {
    const { result, rerender, unmount } = renderHook(({ code }) => useTable(code, 'Ann'), {
      initialProps: { code: 'REEF-42' },
    })
    const wsA = created[0]!
    act(() => wsA.serverOpen())
    expect(result.current.snapshot).toBeNull()

    // Switch to a different table. The effect cleanup closes wsA (which
    // fires wsA's own 'close' listener), and a new socket is opened for
    // the new code.
    rerender({ code: 'ATOL-07' })
    expect(created).toHaveLength(2)
    const wsB = created[1]!
    act(() => wsB.serverOpen())

    // A message arriving late on the OLD socket must be dropped, not folded
    // into the new table's session.
    const staleSnapshot = makeSnapshot(5, 'REEF-42')
    act(() => wsA.serverMessage(staleSnapshot))
    expect(result.current.snapshot).toBeNull()

    // The new socket still works normally.
    const freshSnapshot = makeSnapshot(1, 'ATOL-07')
    act(() => wsB.serverMessage(freshSnapshot))
    expect(result.current.snapshot).toEqual(freshSnapshot)

    unmount()
  })

  it('does not break when localStorage throws on read and write', () => {
    vi.stubGlobal('localStorage', createThrowingStorage())

    const { result, unmount } = renderHook(() => useTable('REEF-42', 'Ann'))
    const ws = created[0]!

    expect(() => act(() => ws.serverOpen())).not.toThrow()
    expect(result.current.status).toBe('open')
    expect(ws.sentMessages()).toEqual([{ type: 'hello', token: undefined, name: 'Ann' }])

    expect(() =>
      act(() => ws.serverMessage({ type: 'welcome', token: 'tok', seat: 2 })),
    ).not.toThrow()
    expect(result.current.seat).toBe(2)

    unmount()
  })
})
