export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8787'

export async function createTable(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/tables`, { method: 'POST' })
  if (!res.ok) throw new Error(`could not set a table (${res.status})`)
  const body = (await res.json()) as { code: string }
  return body.code
}

export function wsUrl(code: string): string {
  const base = API_BASE.replace(/^http/, 'ws')
  return `${base}/api/tables/${encodeURIComponent(code)}/ws`
}
