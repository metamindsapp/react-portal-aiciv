import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useCalendarStore } from '../stores/calendarStore'
import { useMailStore } from '../stores/mailStore'

const mockFetch = vi.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  localStorage.clear()
  useAuthStore.setState({
    token: null,
    authenticated: false,
    loading: false,
    error: null,
    expiresAt: null,
    sessionMode: null,
  })
})

describe('authStore', () => {
  it('starts unauthenticated with no retained bootstrap token', () => {
    const state = useAuthStore.getState()
    expect(state.authenticated).toBe(false)
    expect(state.token).toBeNull()
  })

  it('login exchanges a valid bootstrap token for an HttpOnly session and discards the token', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        authenticated: true,
        expiresAt: 1_800_000_000_000,
        sessionMode: 'http_only_cookie',
      }))
      .mockResolvedValueOnce(jsonResponse({ civ: 'synth', uptime: 100 }))

    const result = await useAuthStore.getState().login('test-token')
    expect(result).toBe(true)
    const state = useAuthStore.getState()
    expect(state.authenticated).toBe(true)
    expect(state.token).toBeNull()
    expect(state.sessionMode).toBe('http_only_cookie')
    expect(state.expiresAt).toBe(1_800_000_000_000)
    expect(localStorage.getItem('aiciv-portal-token')).toBeNull()

    const [sessionPath, sessionOptions] = mockFetch.mock.calls[0]
    expect(sessionPath).toBe('/api/session/start')
    expect(sessionOptions.headers.Authorization).toBe('Bearer test-token')
  })

  it('login fails closed when bootstrap credential is rejected', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_portal_credential' }, 401))

    const result = await useAuthStore.getState().login('bad-token')
    expect(result).toBe(false)
    expect(useAuthStore.getState().authenticated).toBe(false)
    expect(useAuthStore.getState().error).toBe('Invalid or unavailable Portal credential')
    expect(localStorage.getItem('aiciv-portal-token')).toBeNull()
  })

  it('logout revokes the server session and clears browser bootstrap state', async () => {
    localStorage.setItem('aiciv-portal-token', 'legacy-token')
    useAuthStore.setState({ authenticated: true, sessionMode: 'http_only_cookie' })
    mockFetch.mockResolvedValueOnce(jsonResponse({ authenticated: false, revoked: true }))

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState().authenticated).toBe(false)
    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().sessionMode).toBeNull()
    expect(localStorage.getItem('aiciv-portal-token')).toBeNull()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/session')
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('settingsStore', () => {
  it('defaults to dark theme', () => {
    const state = useSettingsStore.getState()
    expect(state.theme).toBe('dark')
  })

  it('persists theme to localStorage', () => {
    useSettingsStore.getState().setTheme('light')
    expect(localStorage.getItem('aiciv-theme')).toBe('light')
    expect(useSettingsStore.getState().theme).toBe('light')
  })

  it('manages quickfire pills', () => {
    const pills = ['Hello', 'Status']
    useSettingsStore.getState().setQuickfirePills(pills)
    expect(useSettingsStore.getState().quickfirePills).toEqual(pills)
  })

  it('loads theme from storage', () => {
    localStorage.setItem('aiciv-theme', 'light')
    useSettingsStore.getState().loadFromStorage()
    expect(useSettingsStore.getState().theme).toBe('light')
  })
})

describe('calendarStore', () => {
  it('starts with month view and empty tasks', () => {
    const state = useCalendarStore.getState()
    expect(state.viewMode).toBe('month')
    expect(state.tasks).toEqual([])
  })

  it('switches view modes', () => {
    useCalendarStore.getState().setViewMode('week')
    expect(useCalendarStore.getState().viewMode).toBe('week')
    useCalendarStore.getState().setViewMode('day')
    expect(useCalendarStore.getState().viewMode).toBe('day')
  })

  it('loads tasks from API', async () => {
    const mockTasks = [
      { id: 'task-1', message: 'Test task', fire_at: '2026-03-20T10:00:00Z', status: 'pending' },
    ]
    mockFetch.mockResolvedValueOnce(jsonResponse({ tasks: mockTasks }))

    await useCalendarStore.getState().loadTasks()
    const tasks = useCalendarStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('task-1')
    expect(tasks[0].message).toBe('Test task')
    expect(tasks[0].status).toBe('pending')
    expect(useCalendarStore.getState().loading).toBe(false)
  })

  it('handles load failure gracefully', async () => {
    useCalendarStore.setState({ tasks: [] })
    mockFetch.mockRejectedValueOnce(new Error('network error'))
    await useCalendarStore.getState().loadTasks()
    expect(useCalendarStore.getState().loading).toBe(false)
    expect(useCalendarStore.getState().tasks).toEqual([])
  })
})

describe('mailStore', () => {
  it('starts with inbox folder', () => {
    const state = useMailStore.getState()
    expect(state.folder).toBe('inbox')
    expect(state.inbox).toEqual([])
    expect(state.unreadCount).toBe(0)
  })

  it('switches folders and clears selection', () => {
    useMailStore.setState({ selectedMessage: { id: 1 } as never })
    useMailStore.getState().setFolder('sent')
    expect(useMailStore.getState().folder).toBe('sent')
    expect(useMailStore.getState().selectedMessage).toBeNull()
  })

  it('loads inbox and counts unread', async () => {
    const mockMessages = [
      { id: 1, from_agent: 'A', to_agent: 'B', subject: 'Hi', body: 'Hello', timestamp: '2026-03-18T10:00:00Z', read: false, archived: false, thread_id: null },
      { id: 2, from_agent: 'C', to_agent: 'B', subject: 'Hey', body: 'World', timestamp: '2026-03-18T11:00:00Z', read: true, archived: false, thread_id: null },
    ]
    mockFetch.mockResolvedValueOnce(jsonResponse({ messages: mockMessages }))

    await useMailStore.getState().loadInbox()
    expect(useMailStore.getState().inbox).toEqual(mockMessages)
    expect(useMailStore.getState().unreadCount).toBe(1)
  })

  it('marks message as read and decrements count', async () => {
    useMailStore.setState({
      inbox: [
        { id: 1, read: false } as never,
        { id: 2, read: true } as never,
      ],
      unreadCount: 1,
    })

    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await useMailStore.getState().markRead(1)
    const msg = useMailStore.getState().inbox.find(m => m.id === 1)
    expect(msg?.read).toBe(true)
    expect(useMailStore.getState().unreadCount).toBe(0)
  })
})
