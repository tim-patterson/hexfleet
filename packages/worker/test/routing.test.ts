import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { isTableCode } from '@hexfleet/shared'

const ORIGIN = 'http://localhost:5173'

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const res = await SELF.fetch('https://api.test/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('POST /api/tables', () => {
  it('mints a well-formed table code', async () => {
    const res = await SELF.fetch('https://api.test/api/tables', {
      method: 'POST',
      headers: { Origin: ORIGIN },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { code: string }
    expect(isTableCode(body.code)).toBe(true)
  })

  it('echoes the allowed origin', async () => {
    const res = await SELF.fetch('https://api.test/api/tables', {
      method: 'POST',
      headers: { Origin: ORIGIN },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('rejects a disallowed origin', async () => {
    const res = await SELF.fetch('https://api.test/api/tables', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  it('mints distinct codes across many calls', async () => {
    const codes = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const res = await SELF.fetch('https://api.test/api/tables', {
        method: 'POST',
        headers: { Origin: ORIGIN },
      })
      codes.add(((await res.json()) as { code: string }).code)
    }
    expect(codes.size).toBe(12)
  })
})

describe('OPTIONS preflight', () => {
  it('answers with the CORS headers', async () => {
    const res = await SELF.fetch('https://api.test/api/tables', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    const res = await SELF.fetch('https://api.test/nope', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/tables/:code/ws', () => {
  it('rejects a malformed code', async () => {
    const res = await SELF.fetch('https://api.test/api/tables/nope/ws', {
      headers: { Origin: ORIGIN, Upgrade: 'websocket' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects a request that is not an upgrade', async () => {
    const res = await SELF.fetch('https://api.test/api/tables/REEF-42/ws', {
      headers: { Origin: ORIGIN },
    })
    expect(res.status).toBe(426)
  })

  it('rejects a disallowed origin', async () => {
    const res = await SELF.fetch('https://api.test/api/tables/REEF-42/ws', {
      headers: { Origin: 'https://evil.example', Upgrade: 'websocket' },
    })
    expect(res.status).toBe(403)
  })
})
