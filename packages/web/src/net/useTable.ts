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

      ws.addEventListener('open', () => {
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
        let msg: ServerMsg
        try {
          msg = JSON.parse(e.data as string) as ServerMsg
        } catch {
          return
        }
        if (msg.type === 'welcome') writeToken(code, msg.token)
        setSession((prev) => {
          const next = receive(prev, msg)
          if (next.needsResync && !prev.needsResync && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resync' } satisfies ClientMsg))
          }
          return next
        })
      })

      const retry = () => {
        wsRef.current = null
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

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }, [])

  return { status, snapshot: session.snapshot, seat: session.seat, error: session.error, send }
}
