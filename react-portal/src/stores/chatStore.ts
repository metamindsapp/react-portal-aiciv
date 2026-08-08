import { create } from 'zustand'
import { fetchChatHistory, sendChatMessage, sendReaction } from '../api/chat'
import { fetchCollaborationState, persistReactionSummary } from '../api/collaboration'
import { chatWs, type ChatSocketState } from '../api/websocket'
import type { ChatMessage, Reaction } from '../types/chat'

let wsCleanup: (() => void) | null = null

interface ChatState {
  messages: ChatMessage[]
  loading: boolean
  sending: boolean
  wsConnected: boolean
  wsState: ChatSocketState
  error: string | null
  focusMessageId: string | null
  setFocusMessageId: (messageId: string | null) => void
  loadHistory: () => Promise<void>
  send: (text: string) => Promise<void>
  react: (
    msgId: string,
    emoji: string,
    action: 'add' | 'remove',
    msgText: string,
    msgRole: 'user' | 'assistant',
  ) => Promise<void>
  connectWs: () => void
  disconnectWs: () => void
}

function mergeReactionMaps(message: ChatMessage, shared: Record<string, Reaction[]>): ChatMessage {
  const sharedReactions = shared[message.id]
  return sharedReactions?.length ? { ...message, reactions: sharedReactions } : message
}

function applyReaction(reactions: Reaction[] | undefined, emoji: string, action: 'add' | 'remove'): Reaction[] {
  const next = (reactions || []).map((reaction) => ({ ...reaction }))
  const index = next.findIndex((reaction) => reaction.emoji === emoji)
  if (action === 'add') {
    if (index >= 0) {
      if (!next[index].mine) {
        next[index].mine = true
        next[index].count += 1
      }
    } else next.push({ emoji, count: 1, mine: true })
  } else if (index >= 0 && next[index].mine) {
    next[index].mine = false
    next[index].count = Math.max(0, next[index].count - 1)
    if (next[index].count === 0) next.splice(index, 1)
  }
  return next
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
  wsConnected: false,
  wsState: 'disconnected',
  error: null,
  focusMessageId: null,

  setFocusMessageId: (messageId) => set({ focusMessageId: messageId }),

  loadHistory: async () => {
    set({ loading: true, error: null })
    try {
      const [history, collaboration] = await Promise.all([
        fetchChatHistory(200),
        fetchCollaborationState().catch(() => ({ version: 1, bookmarks: [], reactions: {} })),
      ])
      const msgs = (history.messages || []).map((message) => mergeReactionMaps(message, collaboration.reactions))
      set({ messages: msgs, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load chat' })
    }
  },

  send: async (text) => {
    set({ sending: true, error: null })
    try {
      await sendChatMessage(text)
      const userMsg: ChatMessage = {
        id: `local-${Date.now()}`,
        text,
        role: 'user',
        timestamp: Date.now() / 1000,
      }
      set(s => ({ messages: [...s.messages, userMsg], sending: false }))
    } catch (e) {
      set({ sending: false, error: e instanceof Error ? e.message : 'Message delivery failed' })
    }
  },

  react: async (msgId, emoji, action, msgText, msgRole) => {
    const before = get().messages
    const target = before.find((message) => message.id === msgId)
    if (!target) return
    const reactions = applyReaction(target.reactions, emoji, action)
    set({ messages: before.map((message) => message.id === msgId ? { ...message, reactions } : message), error: null })
    try {
      await sendReaction({ msg_id: msgId, emoji, action, msg_preview: msgText.slice(0, 200), msg_role: msgRole })
      await persistReactionSummary(msgId, reactions)
    } catch (e) {
      set({ messages: before, error: e instanceof Error ? e.message : 'Reaction failed' })
    }
  },

  connectWs: () => {
    wsCleanup?.()
    const cleanMessage = chatWs.onMessage((msg) => {
      set((s) => {
        const idx = s.messages.findIndex(m => m.id === msg.id)
        if (idx >= 0) {
          const updated = [...s.messages]
          updated[idx] = { ...msg, reactions: msg.reactions ?? updated[idx].reactions }
          return { messages: updated }
        }
        if (msg.role === 'user') {
          const localIdx = s.messages.findIndex(m => m.id.startsWith('local-') && m.role === 'user' && m.text === msg.text)
          if (localIdx >= 0) {
            const updated = [...s.messages]
            updated[localIdx] = msg
            return { messages: updated }
          }
        }
        return { messages: [...s.messages, msg] }
      })
    })
    const cleanState = chatWs.onState((state) => set({ wsState: state, wsConnected: state === 'connected' }))
    wsCleanup = () => {
      cleanMessage()
      cleanState()
      wsCleanup = null
    }
    chatWs.connect()
  },

  disconnectWs: () => {
    wsCleanup?.()
    chatWs.disconnect()
    set({ wsConnected: false, wsState: 'disconnected' })
  },
}))
