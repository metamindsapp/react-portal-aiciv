import { create } from 'zustand'
import { apiGet, apiPost } from '../api/client'
import type { HubGroup, HubPost, HubRoom, HubThread } from '../types/hub'

/**
 * GroupChatView was already shipped on main but its Zustand store was missing,
 * which made the entire Portal TypeScript production build fail. Keep this
 * store intentionally thin: the Portal backend owns Hub auth and response
 * normalization, while the view owns presentation.
 */
export interface GroupChatThread extends HubThread {
  room_label?: string
}

interface GroupChatState {
  threads: GroupChatThread[]
  activeThreadId: string | null
  messages: HubPost[]
  loading: boolean
  sending: boolean
  error: string | null
  loadThreads: () => Promise<void>
  setActiveThread: (threadId: string) => Promise<void>
  sendMessage: (text: string) => Promise<void>
  newThread: (title: string, body: string) => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function threadPosts(value: unknown): HubPost[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return asArray<HubPost>(record.posts)
}

async function loadRoomsAndThreads(): Promise<GroupChatThread[]> {
  const groups = asArray<HubGroup>(await apiGet<unknown>('/api/hub/groups'))
  const collected: GroupChatThread[] = []

  for (const group of groups) {
    if (!group?.id) continue
    let rooms: HubRoom[] = []
    try {
      rooms = asArray<HubRoom>(await apiGet<unknown>(`/api/hub/groups/${encodeURIComponent(group.id)}/rooms`))
    } catch {
      // One unavailable Hub group should not blank every other group chat.
      continue
    }

    for (const room of rooms) {
      if (!room?.id) continue
      try {
        const threads = asArray<HubThread>(
          await apiGet<unknown>(`/api/hub/rooms/${encodeURIComponent(room.id)}/threads/list?limit=50&offset=0`),
        )
        for (const thread of threads) {
          if (!thread?.id) continue
          collected.push({
            ...thread,
            room_id: thread.room_id || room.id,
            room_label: room.display_name || room.slug || group.display_name,
          })
        }
      } catch {
        continue
      }
    }
  }

  collected.sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : 0
    const bTime = b.created_at ? Date.parse(b.created_at) : 0
    return bTime - aTime
  })
  return collected
}

async function fetchThreadPosts(threadId: string): Promise<HubPost[]> {
  const data = await apiGet<unknown>(`/api/hub/threads/${encodeURIComponent(threadId)}`)
  if (Array.isArray(data)) return asArray<HubPost>(data)
  return threadPosts(data)
}

export const useGroupChatStore = create<GroupChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: [],
  loading: false,
  sending: false,
  error: null,

  loadThreads: async () => {
    set({ loading: true, error: null })
    try {
      const threads = await loadRoomsAndThreads()
      const current = get().activeThreadId
      const stillExists = current && threads.some(thread => thread.id === current)
      set({
        threads,
        activeThreadId: stillExists ? current : null,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load group conversations',
      })
    }
  },

  setActiveThread: async (threadId: string) => {
    set({ activeThreadId: threadId, loading: true, error: null })
    try {
      const messages = await fetchThreadPosts(threadId)
      // Hub may return nested replies in API order; created_at keeps a stable
      // conversational timeline when all timestamps are present.
      messages.sort((a, b) => {
        const aTime = a.created_at ? Date.parse(a.created_at) : 0
        const bTime = b.created_at ? Date.parse(b.created_at) : 0
        return aTime - bTime
      })
      if (get().activeThreadId === threadId) {
        set({ messages, loading: false })
      }
    } catch (error) {
      if (get().activeThreadId === threadId) {
        set({
          messages: [],
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load conversation',
        })
      }
    }
  },

  sendMessage: async (text: string) => {
    const threadId = get().activeThreadId
    if (!threadId || !text.trim()) return

    set({ sending: true, error: null })
    try {
      // Prefix is the existing GroupChatView's author convention. The backend
      // and other CIVs can still rely on normal Hub identity metadata too.
      await apiPost<unknown>(`/api/hub/threads/${encodeURIComponent(threadId)}/posts`, {
        body: `[Corey] ${text.trim()}`,
      })
      const messages = await fetchThreadPosts(threadId)
      if (get().activeThreadId === threadId) set({ messages, sending: false })
      else set({ sending: false })
    } catch (error) {
      set({
        sending: false,
        error: error instanceof Error ? error.message : 'Failed to send group message',
      })
    }
  },

  newThread: async (title: string, body: string) => {
    if (!title.trim()) return
    set({ sending: true, error: null })
    try {
      const groups = asArray<HubGroup>(await apiGet<unknown>('/api/hub/groups'))
      let targetRoom: HubRoom | null = null

      // Prefer an explicitly group-chat-like room, otherwise use the first
      // available room. This repairs the existing UI without hard-coding one
      // deployment's UUIDs into the frontend.
      for (const group of groups) {
        if (!group?.id) continue
        const rooms = asArray<HubRoom>(
          await apiGet<unknown>(`/api/hub/groups/${encodeURIComponent(group.id)}/rooms`),
        )
        targetRoom = rooms.find(room => /group|general|chat/i.test(`${room.slug} ${room.display_name}`)) || rooms[0] || null
        if (targetRoom) break
      }

      if (!targetRoom) throw new Error('No Hub room is available for group chat')

      const created = await apiPost<HubThread>(
        `/api/hub/rooms/${encodeURIComponent(targetRoom.id)}/threads`,
        {
          title: title.trim(),
          body: `[Corey] ${(body || title).trim()}`,
        },
      )

      const threads = await loadRoomsAndThreads()
      set({ threads, sending: false })
      if (created?.id) await get().setActiveThread(created.id)
    } catch (error) {
      set({
        sending: false,
        error: error instanceof Error ? error.message : 'Failed to create conversation',
      })
    }
  },

  startPolling: () => {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(() => {
      const threadId = get().activeThreadId
      if (!threadId) return
      void fetchThreadPosts(threadId)
        .then(messages => {
          if (get().activeThreadId === threadId) set({ messages })
        })
        .catch(() => {
          // Polling is best-effort; explicit actions surface errors separately.
        })
    }, 5_000)
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  },
}))
