import { SELF } from 'cloudflare:test'
import { boardCells, BOARD_RADIUS, cellsFor, key, validateFleet } from '@hexfleet/shared'
import type { ClientMsg, Fleet, Hex, ServerMsg } from '@hexfleet/shared'

export const ORIGIN = 'http://localhost:5173'

export type Client = {
  send: (m: ClientMsg) => void
  /** Send a raw text frame, bypassing JSON.stringify — for malformed-input tests. */
  sendRaw: (raw: string) => void
  next: () => Promise<ServerMsg>
  until: <T extends ServerMsg['type']>(type: T) => Promise<Extract<ServerMsg, { type: T }>>
  untilMatching: <T extends ServerMsg['type']>(
    type: T,
    pred: (m: Extract<ServerMsg, { type: T }>) => boolean,
  ) => Promise<Extract<ServerMsg, { type: T }>>
  close: () => void
}

export async function connect(code: string): Promise<Client> {
  const res = await SELF.fetch(`https://api.test/api/tables/${code}/ws`, {
    headers: { Origin: ORIGIN, Upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error(`no websocket in response (status ${res.status})`)
  ws.accept()

  const queue: ServerMsg[] = []
  const waiters: ((m: ServerMsg) => void)[] = []
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data as string) as ServerMsg
    const w = waiters.shift()
    if (w) w(msg)
    else queue.push(msg)
  })

  const next = () =>
    new Promise<ServerMsg>((resolve, reject) => {
      const q = queue.shift()
      if (q) return resolve(q)
      const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), 3000)
      waiters.push((m) => {
        clearTimeout(timer)
        resolve(m)
      })
    })

  return {
    send: (m) => ws.send(JSON.stringify(m)),
    sendRaw: (raw) => ws.send(raw),
    next,
    async until(type) {
      for (let i = 0; i < 50; i++) {
        const m = await next()
        if (m.type === type) return m as never
      }
      throw new Error(`never saw a ${type} message`)
    },
    async untilMatching(type, pred) {
      for (let i = 0; i < 50; i++) {
        const m = await next()
        if (m.type === type && pred(m as never)) return m as never
      }
      throw new Error(`never saw a ${type} message matching the predicate`)
    },
    close: () => ws.close(),
  }
}

/** Join a table and return the seat number and token. */
export async function join(code: string, name: string) {
  const c = await connect(code)
  c.send({ type: 'hello', name })
  const welcome = await c.until('welcome')
  const snapshot = await c.until('snapshot')
  return { client: c, seat: welcome.seat, token: welcome.token, snapshot }
}

/** Five disjoint E–W hulls, offset by `row` so different seats can differ. */
export function legalFleet(row = 0): Fleet {
  const fleet: Fleet = {
    carrier: cellsFor({ q: -2, r: row }, 0, 5),
    cutter: cellsFor({ q: -2, r: row + 1 }, 0, 4),
    trawler: cellsFor({ q: -2, r: row + 2 }, 0, 3),
    skiff: cellsFor({ q: -2, r: row + 3 }, 0, 3),
    tug: cellsFor({ q: -2, r: row + 4 }, 0, 2),
  }
  // Fail loudly and immediately if a fixture row no longer fits the board.
  // Without this, an off-board fleet is simply rejected with `badFleet`, the
  // test then waits for an event that never arrives, and the suite dies of
  // twenty unrelated 3s timeouts with nothing pointing at the real cause.
  const res = validateFleet(fleet, BOARD_RADIUS)
  if (!res.ok) throw new Error(`legalFleet(${row}) is not legal at radius ${BOARD_RADIUS}: ${res.reason}`)
  return fleet
}

/** Board cells occupied by none of the given fleets, in board order. */
export function openCells(radius: number, ...fleets: Fleet[]): Hex[] {
  const taken = new Set<string>()
  for (const f of fleets) {
    for (const cs of Object.values(f)) for (const c of cs) taken.add(key(c.q, c.r))
  }
  return boardCells(radius).filter((c) => !taken.has(key(c.q, c.r)))
}
