import { isTableCode } from '@hexfleet/shared'
import { allowedOrigin, corsHeaders } from './cors.js'
import { randomCode } from './codes.js'

export { TableDO } from './table-do.js'

export type Env = {
  TABLES: DurableObjectNamespace
  ALLOWED_ORIGINS: string
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/api/health') return Response.json({ ok: true })

    const origin = allowedOrigin(req, env)
    const cors = corsHeaders(origin)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (!origin) return new Response('forbidden origin', { status: 403 })

    if (url.pathname === '/api/tables' && req.method === 'POST') {
      const code = await mintCode(env)
      if (!code) return new Response('no codes available', { status: 503, headers: cors })
      return Response.json({ code }, { headers: cors })
    }

    const ws = url.pathname.match(/^\/api\/tables\/([^/]+)\/ws$/)
    if (ws) {
      const code = decodeURIComponent(ws[1]!).toUpperCase()
      if (!isTableCode(code)) return new Response('bad table code', { status: 400, headers: cors })
      if (req.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426, headers: cors })
      }
      const id = env.TABLES.idFromName(code)
      return env.TABLES.get(id).fetch(new Request(`https://do/ws?code=${code}`, req))
    }

    return new Response('not found', { status: 404, headers: cors })
  },
}

async function mintCode(env: Env): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode()
    const id = env.TABLES.idFromName(code)
    const res = await env.TABLES.get(id).fetch(`https://do/claim?code=${code}`, { method: 'POST' })
    const { claimed } = (await res.json()) as { claimed: boolean }
    if (claimed) return code
  }
  return null
}
