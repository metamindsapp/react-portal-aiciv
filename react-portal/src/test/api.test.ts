import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, apiFetch, apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../api/client'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
  localStorage.clear()
})

describe('apiFetch', () => {
  it('sends Authorization and correlation headers when token exists', async () => {
    localStorage.setItem('aiciv-portal-token', 'my-token')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'req_server_1234' }),
      json: () => Promise.resolve({ data: 'test' }),
    })

    await apiFetch('/api/test')
    expect(mockFetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({
        Authorization: 'Bearer my-token',
        'X-Request-ID': expect.stringMatching(/^web_/),
      }),
    }))
  })

  it('does not send Authorization header without token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    })
    await apiFetch('/api/test')
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('sets Content-Type for JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    })
    await apiFetch('/api/test', { method: 'POST', body: JSON.stringify({ key: 'value' }) })
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  it('throws a stable ApiError with request ID on non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ 'x-request-id': 'req_server_500' }),
      text: () => Promise.resolve('Internal Server Error'),
    })

    try {
      await apiFetch('/api/fail')
      expect.fail('expected apiFetch to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const apiError = error as ApiError
      expect(apiError.code).toBe('http_500')
      expect(apiError.status).toBe(500)
      expect(apiError.requestId).toBe('req_server_500')
      expect(apiError.path).toBe('/api/fail')
    }
  })

  it('handles 401 by clearing token and emitting auth-expired without reloading', async () => {
    localStorage.setItem('aiciv-portal-token', 'old-token')
    const listener = vi.fn()
    window.addEventListener('aiciv:auth-expired', listener)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ 'x-request-id': 'req_auth_123' }),
      text: () => Promise.resolve('unauthorized'),
    })

    await expect(apiFetch('/api/test')).rejects.toMatchObject({ status: 401, requestId: 'req_auth_123' })
    expect(localStorage.getItem('aiciv-portal-token')).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('aiciv:auth-expired', listener)
  })

  it('returns text for non-JSON responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve('plain text response'),
    })
    expect(await apiFetch<string>('/api/test')).toBe('plain text response')
  })
})

describe('convenience methods', () => {
  const jsonResponse = (data: unknown) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
  })

  it('apiGet sends GET request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [] }))
    const result = await apiGet<{ items: [] }>('/api/items')
    expect(result).toEqual({ items: [] })
    expect(mockFetch.mock.calls[0][1].method).toBeUndefined()
  })

  it('apiPost sends POST with body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiPost('/api/create', { name: 'test' })
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ name: 'test' })
  })

  it('apiPut sends PUT with body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiPut('/api/update/1', { name: 'updated' })
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT')
  })

  it('apiPatch sends PATCH with body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiPatch('/api/patch/1', { status: 'done' })
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH')
  })

  it('apiDelete sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiDelete('/api/delete/1')
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE')
  })
})
