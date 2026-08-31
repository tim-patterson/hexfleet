import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClientMsg, ServerMsg } from '@hexfleet/shared'
import { wsUrl } from '../api.js'
import { initialSession, receive } from './session.js'
import type { Session } from './session.js'

export type Table = {
  status: 'connecting' | 'open' | 'closed'
  snapshot: Session['snapshot']
  seat: number | null
  error: Session['error']
  send: (m: ClientMsg) => void
}

export function tokenKey(code: string): string {
  return `hexfleet:seat:${code}`
}

function readToken(code: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined
  } catch {
    return undefined
  }
}

function writeToken(code: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(code), token)
  } catch {
    // Private browsing or blocked storage -- the seat simply won't survive a reload.
  }
}

export function useTable(code: string | null, name: string): Table {
  const [session, setSession] = useState<Session>(initialSession)
  const [status, setStatus] = useState<Table['status']>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const nameRef = useRef(name)
  nameRef.current = name

  useEffect(() => {
    if (!code) return
    let closed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const open = () => {
      if (closed) return
      setStatus('connecting')
      const ws = new WebSocket(wsUrl(code))
      wsRef.current = ws

      // Every listener below must check `closed`/`wsRef.current` before
      // touching state: once `code` changes (or the effect unmounts), a
      // message already in flight from THIS socket must not be allowed to
      // land in a session that now belongs to a different table.
      ws.addEventListener('open', () => {
        if (closed || wsRef.current !== ws) return
        attempt = 0
        setStatus('open')
        ws.send(
          JSON.stringify({
            type: 'hello',
            token: readToken(code),
            name: nameRef.current,
          } satisfies ClientMsg),
        )
      })

      ws.addEventListener('message', (e) => {
        if (closed || wsRef.current !== ws) return
        let msg: ServerMsg
        try {
          msg = JSON.parse(e.data as string) as ServerMsg
        } catch {
          return
        }
        if (msg.type === 'welcome') writeToken(code, msg.token)
        setSession((prev) => receive(prev, msg))
      })

      const retry = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (closed) return
        setStatus('closed')
        attempt += 1
        const delay = Math.min(15_000, 500 * 2 ** (attempt - 1)) + Math.random() * 400
        timer = setTimeout(open, delay)
      }

      ws.addEventListener('close', retry)
      ws.addEventListener('error', () => ws.close())
    }

    open()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [code])

  // Fire `resync` exactly once per gap. This must NOT live inside the
  // `setSession` updater above: React 18/19 StrictMode double-invokes state
  // updaters in development to surface impurity, which would double-send a
  // network call from a position that is contractually required to be pure.
  // A ref (not state) tracks the previous value so this effect sees the
  // false -> true transition without re-running on every render.
  const wasResyncingRef = useRef(false)
  useEffect(() => {
    const wasResyncing = wasResyncingRef.current
    wasResyncingRef.current = session.needsResync
    if (!session.needsResync || wasResyncing) return
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resync' } satisfies ClientMsg))
    }
  }, [session.needsResync])

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }, [])

  return { status, snapshot: session.snapshot, seat: session.seat, error: session.error, send }
}
