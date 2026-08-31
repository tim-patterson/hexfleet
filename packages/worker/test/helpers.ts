import { SELF } from 'cloudflare:test'
import type { ClientMsg, ServerMsg } from '@hexfleet/shared'

export const ORIGIN = 'http://localhost:5173'

export type Client = {
  send: (m: ClientMsg) => void
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
