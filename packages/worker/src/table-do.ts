import type { Env } from './index.js'

export class TableDO {
  constructor(
    protected ctx: DurableObjectState,
    protected env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/claim') return this.claim(url.searchParams.get('code') ?? '')
    return new Response('not found', { status: 404 })
  }

  /** Reserve this code if free. Atomic: only one caller can win. */
  protected async claim(code: string): Promise<Response> {
    const existing = await this.ctx.storage.get<string>('code')
    if (existing) return Response.json({ claimed: false })
    await this.ctx.storage.put('code', code)
    return Response.json({ claimed: true })
  }
}
