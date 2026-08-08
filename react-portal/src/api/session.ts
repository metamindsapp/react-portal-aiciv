import { ApiError } from './client'

export interface PortalSessionStatus {
  authenticated: boolean
  expiresAt: number | null
  sessionMode: 'http_only_cookie' | null
}

function requestId(): string {
  try { return `web_${crypto.randomUUID()}` } catch { return `web_${Date.now()}` }
}

async function parseFailure(res: Response, path: string, id: string): Promise<never> {
  let code = `http_${res.status}`
  let message = `Request failed with HTTP ${res.status}`
  try {
    const body = await res.json() as Record<string, unknown>
    if (typeof body.error === 'string') code = body.error
    if (typeof body.message === 'string') message = body.message
    else message = code.replaceAll('_', ' ')
  } catch {
    // Stable status-only fallback.
  }
  throw new ApiError({
    message,
    code,
    status: res.status,
    path,
    requestId: res.headers.get('x-request-id') || id,
  })
}

export async function startPortalSession(bootstrapCredential: string): Promise<PortalSessionStatus> {
  const path = '/api/session/start'
  const id = requestId()
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Authorization: `Bearer ${bootstrapCredential}`,
      'X-Request-ID': id,
      Accept: 'application/json',
    },
  })
  if (!res.ok) return parseFailure(res, path, id)
  return res.json()
}

export async function getPortalSession(): Promise<PortalSessionStatus> {
  const path = '/api/session'
  const id = requestId()
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'X-Request-ID': id, Accept: 'application/json' },
  })
  if (!res.ok) return parseFailure(res, path, id)
  return res.json()
}

export async function endPortalSession(): Promise<void> {
  const path = '/api/session'
  const id = requestId()
  const res = await fetch(path, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'X-Request-ID': id, Accept: 'application/json' },
  })
  if (!res.ok) return parseFailure(res, path, id)
}
