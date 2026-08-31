import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function freshWsUrl(base: string) {
  vi.resetModules()
  vi.stubEnv('VITE_API_BASE', base)
  const mod = await import('./api.js')
  return mod.wsUrl
}

describe('wsUrl', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rewrites an http:// base to a ws:// URL', async () => {
    const wsUrl = await freshWsUrl('http://127.0.0.1:8787')
    expect(wsUrl('REEF-42')).toBe('ws://127.0.0.1:8787/api/tables/REEF-42/ws')
  })

  it('rewrites an https:// base to a wss:// URL', async () => {
    const wsUrl = await freshWsUrl('https://api.hexfleet.example.com')
    expect(wsUrl('REEF-42')).toBe('wss://api.hexfleet.example.com/api/tables/REEF-42/ws')
  })

  it('does not mangle a host that merely contains the substring "http"', async () => {
    const wsUrl = await freshWsUrl('https://myhttpserver.example.com')
    expect(wsUrl('REEF-42')).toBe('wss://myhttpserver.example.com/api/tables/REEF-42/ws')
  })

  it('URL-encodes the table code', async () => {
    const wsUrl = await freshWsUrl('http://127.0.0.1:8787')
    expect(wsUrl('AB CD-12')).toBe('ws://127.0.0.1:8787/api/tables/AB%20CD-12/ws')
  })
})
