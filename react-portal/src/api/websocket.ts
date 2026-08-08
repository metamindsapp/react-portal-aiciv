import { AUTH_TOKEN_KEY } from '../utils/constants'
import type { ChatMessage } from '../types/chat'

type MessageHandler = (msg: ChatMessage) => void
export type ChatSocketState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized'
type StateHandler = (state: ChatSocketState) => void

export class ChatWebSocket {
  private ws: WebSocket | null = null
  private handlers: Set<MessageHandler> = new Set()
  private stateHandlers: Set<StateHandler> = new Set()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private disposed = false
  private _state: ChatSocketState = 'disconnected'

  get connected(): boolean {
    return this._state === 'connected'
  }

  get state(): ChatSocketState {
    return this._state
  }

  private setState(state: ChatSocketState): void {
    if (this._state === state) return
    this._state = state
    this.stateHandlers.forEach(handler => handler(state))
  }

  connect(): void {
    this.disposed = false
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return

    const legacyToken = localStorage.getItem(AUTH_TOKEN_KEY)
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // Same-origin WebSockets automatically carry the HttpOnly session cookie.
    // Keep the query parameter only as a migration fallback for an older browser
    // that has not yet exchanged its stored Portal bearer.
    const query = legacyToken ? `?token=${encodeURIComponent(legacyToken)}` : ''
    const url = `${proto}//${window.location.host}/ws/chat${query}`
    this.setState(this.reconnectDelay > 1000 ? 'reconnecting' : 'connecting')

    try {
      this.ws = new WebSocket(url)
    } catch {
      this.ws = null
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      if (this.disposed) return
      this.reconnectDelay = 1000
      this.setState('connected')
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data)
        // Core sends keepalive ping objects over the same channel. Ignore them
        // rather than treating them as malformed chat messages.
        if ((msg as unknown as { type?: string }).type === 'ping') return
        this.handlers.forEach(handler => handler(msg))
      } catch {
        window.dispatchEvent(new CustomEvent('aiciv:error', {
          detail: { message: 'A malformed chat WebSocket message was ignored.', code: 'malformed_websocket_message', path: '/ws/chat' },
        }))
      }
    }

    this.ws.onclose = (event) => {
      this.ws = null
      if (this.disposed) {
        this.setState('disconnected')
        return
      }
      if (event.code === 4401) {
        this.setState('unauthorized')
        window.dispatchEvent(new CustomEvent('aiciv:auth-expired', { detail: { status: 401, path: '/ws/chat' } }))
        return
      }
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  disconnect(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.ws
    this.ws = null
    socket?.close()
    this.reconnectDelay = 1000
    this.setState('disconnected')
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler)
    handler(this._state)
    return () => this.stateHandlers.delete(handler)
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return
    this.setState('reconnecting')
    const delay = this.reconnectDelay
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      this.connect()
    }, delay)
  }
}

export const chatWs = new ChatWebSocket()
