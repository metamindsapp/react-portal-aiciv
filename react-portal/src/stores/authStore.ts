import { create } from 'zustand'
import { AUTH_TOKEN_KEY } from '../utils/constants'
import { fetchStatus } from '../api/identity'
import { endPortalSession, getPortalSession, startPortalSession } from '../api/session'

interface AuthState {
  /** Legacy bootstrap token exists only long enough to exchange for a session. */
  token: string | null
  authenticated: boolean
  loading: boolean
  error: string | null
  expiresAt: number | null
  sessionMode: 'http_only_cookie' | 'legacy_bearer' | null
  login: (token: string) => Promise<boolean>
  logout: () => Promise<void>
  checkAuth: () => Promise<boolean>
}

async function validateLivePortal(): Promise<boolean> {
  try {
    await fetchStatus()
    return true
  } catch {
    return false
  }
}

async function exchangeLegacyCredential(token: string) {
  const session = await startPortalSession(token)
  localStorage.removeItem(AUTH_TOKEN_KEY)
  return session
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  authenticated: false,
  loading: true,
  error: null,
  expiresAt: null,
  sessionMode: null,

  login: async (token: string) => {
    const trimmed = token.trim()
    if (!trimmed) {
      set({ authenticated: false, loading: false, error: 'Portal credential is required' })
      return false
    }

    set({ token: trimmed, loading: true, error: null })
    try {
      const session = await exchangeLegacyCredential(trimmed)
      const live = await validateLivePortal()
      if (!live) throw new Error('Portal session was created but the AICIV status check failed')
      set({
        token: null,
        authenticated: true,
        loading: false,
        error: null,
        expiresAt: session.expiresAt,
        sessionMode: 'http_only_cookie',
      })
      return true
    } catch {
      localStorage.removeItem(AUTH_TOKEN_KEY)
      set({ token: null, authenticated: false, loading: false, error: 'Invalid or unavailable Portal credential', expiresAt: null, sessionMode: null })
      return false
    }
  },

  logout: async () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    try { await endPortalSession() } catch { /* local auth state still ends */ }
    set({ token: null, authenticated: false, loading: false, error: null, expiresAt: null, sessionMode: null })
  },

  checkAuth: async () => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      // Remove the long-lived credential from browser history immediately. The
      // local variable remains available for the one-time session exchange.
      const cleanUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', cleanUrl)
      set({ loading: true, error: null })
      try {
        const session = await exchangeLegacyCredential(urlToken)
        const live = await validateLivePortal()
        if (!live) throw new Error('Portal status unavailable')
        set({ authenticated: true, loading: false, token: null, expiresAt: session.expiresAt, sessionMode: 'http_only_cookie' })
        return true
      } catch {
        set({ authenticated: false, loading: false, token: null, expiresAt: null, sessionMode: null })
        return false
      }
    }

    // Preferred path: browser already has a short-lived HttpOnly session.
    try {
      const session = await getPortalSession()
      if (session.authenticated && await validateLivePortal()) {
        localStorage.removeItem(AUTH_TOKEN_KEY)
        set({ authenticated: true, loading: false, token: null, expiresAt: session.expiresAt, sessionMode: 'http_only_cookie' })
        return true
      }
    } catch {
      // Fall through to one-time migration of an older browser localStorage token.
    }

    const legacy = localStorage.getItem(AUTH_TOKEN_KEY)
    if (legacy) {
      try {
        const session = await exchangeLegacyCredential(legacy)
        const live = await validateLivePortal()
        if (!live) throw new Error('Portal status unavailable')
        set({ authenticated: true, loading: false, token: null, expiresAt: session.expiresAt, sessionMode: 'http_only_cookie' })
        return true
      } catch {
        localStorage.removeItem(AUTH_TOKEN_KEY)
      }
    }

    set({ authenticated: false, loading: false, token: null, expiresAt: null, sessionMode: null })
    return false
  },
}))
