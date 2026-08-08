import { AUTH_TOKEN_KEY } from '../utils/constants'

export interface PortalErrorEventDetail {
  message: string
  code: string
  status?: number
  requestId?: string
  path?: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  readonly path: string
  readonly detail?: unknown

  constructor(input: {
    message: string
    code: string
    status: number
    path: string
    requestId?: string
    detail?: unknown
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.code = input.code
    this.status = input.status
    this.path = input.path
    if (input.requestId) this.requestId = input.requestId
    if (input.detail !== undefined) this.detail = input.detail
  }
}

function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

function getBaseUrl(): string {
  return ''
}

function newRequestId(): string {
  try {
    return `web_${crypto.randomUUID()}`
  } catch {
    return `web_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function emitPortalError(error: ApiError): void {
  if (error.status === 401 || error.status === 403) return
  window.dispatchEvent(new CustomEvent<PortalErrorEventDetail>('aiciv:error', {
    detail: {
      message: error.message,
      code: error.code,
      status: error.status,
      requestId: error.requestId,
      path: error.path,
    },
  }))
}

async function parseErrorResponse(res: Response): Promise<{ code: string; message: string; detail?: unknown }> {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const body = await res.json() as Record<string, unknown>
      const code = typeof body.error === 'string' && body.error ? body.error : `http_${res.status}`
      const message = typeof body.message === 'string' && body.message
        ? body.message
        : code.replaceAll('_', ' ')
      return { code, message, detail: body }
    } catch {
      // Fall through to stable status-only error.
    }
  }
  return { code: `http_${res.status}`, message: `Request failed with HTTP ${res.status}` }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const requestId = newRequestId()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
    'X-Request-ID': requestId,
  }

  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      ...options,
      headers,
      credentials: 'same-origin',
    })
  } catch (cause) {
    const error = new ApiError({
      message: 'The Portal could not reach its local API.',
      code: 'network_error',
      status: 0,
      path,
      requestId,
      detail: cause,
    })
    emitPortalError(error)
    throw error
  }

  const responseRequestId = res.headers.get('x-request-id') || requestId

  if (!res.ok) {
    const parsed = await parseErrorResponse(res)
    const error = new ApiError({
      message: parsed.message,
      code: parsed.code,
      status: res.status,
      path,
      requestId: responseRequestId,
      detail: parsed.detail,
    })

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(AUTH_TOKEN_KEY)
      window.dispatchEvent(new CustomEvent('aiciv:auth-expired', {
        detail: { status: res.status, requestId: responseRequestId, path },
      }))
    } else {
      emitPortalError(error)
    }
    throw error
  }

  const contentType = res.headers.get('content-type')
  if (contentType?.includes('application/json')) return res.json()
  return res.text() as unknown as T
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined })
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' })
}

export async function uploadFile(file: File): Promise<{ ok: boolean; filename: string; url: string }> {
  const token = getToken()
  const requestId = newRequestId()
  const formData = new FormData()
  formData.append('file', file)

  let res: Response
  try {
    res = await fetch('/api/chat/upload', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Request-ID': requestId,
      },
      credentials: 'same-origin',
      body: formData,
    })
  } catch (cause) {
    const error = new ApiError({ message: 'Upload could not reach the Portal.', code: 'network_error', status: 0, path: '/api/chat/upload', requestId, detail: cause })
    emitPortalError(error)
    throw error
  }

  if (!res.ok) {
    const parsed = await parseErrorResponse(res)
    const error = new ApiError({ message: parsed.message, code: parsed.code, status: res.status, path: '/api/chat/upload', requestId: res.headers.get('x-request-id') || requestId, detail: parsed.detail })
    emitPortalError(error)
    throw error
  }
  return res.json()
}
