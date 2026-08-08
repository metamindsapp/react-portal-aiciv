import { create } from 'zustand'
import {
  createSharedBookmark,
  deleteSharedBookmark,
  fetchCollaborationState,
  type SharedBookmark,
} from '../api/collaboration'
import type { ChatMessage } from '../types/chat'

const LEGACY_STORAGE_KEY = 'aiciv-bookmarks'

export type Bookmark = SharedBookmark

interface BookmarkState {
  bookmarks: Bookmark[]
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  add: (msg: ChatMessage) => Promise<void>
  remove: (msgId: string) => Promise<void>
  isBookmarked: (msgId: string) => boolean
}

interface LegacyBookmark {
  msgId: string
  text: string
  role: 'user' | 'assistant'
  timestamp: number
  savedAt?: number
}

function readLegacyBookmarks(): LegacyBookmark[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function migrateLegacyBookmarks(existing: Bookmark[]): Promise<Bookmark[]> {
  const known = new Set(existing.map((bookmark) => bookmark.msgId))
  const migrated = [...existing]

  for (const legacy of readLegacyBookmarks()) {
    if (!legacy?.msgId || known.has(legacy.msgId)) continue
    try {
      const response = await createSharedBookmark({
        msgId: legacy.msgId,
        text: legacy.text || '',
        role: legacy.role === 'user' ? 'user' : 'assistant',
        timestamp: Number(legacy.timestamp || 0),
        savedAt: legacy.savedAt ? new Date(legacy.savedAt).toISOString() : undefined,
      })
      migrated.push(response.bookmark)
      known.add(legacy.msgId)
    } catch {
      // Keep the legacy key until every item has been migrated successfully.
      return migrated
    }
  }

  localStorage.removeItem(LEGACY_STORAGE_KEY)
  return migrated
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const shared = await fetchCollaborationState()
      const migrated = await migrateLegacyBookmarks(shared.bookmarks || [])
      migrated.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      set({ bookmarks: migrated, loaded: true, loading: false })
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : 'Unable to load shared references',
      })
    }
  },

  add: async (msg) => {
    if (get().bookmarks.some((bookmark) => bookmark.msgId === msg.id)) return

    const optimistic: Bookmark = {
      msgId: msg.id,
      text: msg.text.slice(0, 2000),
      role: msg.role,
      timestamp: msg.timestamp,
      savedAt: new Date().toISOString(),
    }
    set((state) => ({ bookmarks: [optimistic, ...state.bookmarks], error: null }))

    try {
      const response = await createSharedBookmark(optimistic)
      set((state) => ({
        bookmarks: state.bookmarks.map((bookmark) =>
          bookmark.msgId === msg.id ? response.bookmark : bookmark,
        ),
      }))
    } catch (error) {
      set((state) => ({
        bookmarks: state.bookmarks.filter((bookmark) => bookmark.msgId !== msg.id),
        error: error instanceof Error ? error.message : 'Unable to save shared reference',
      }))
    }
  },

  remove: async (msgId) => {
    const previous = get().bookmarks
    if (!previous.some((bookmark) => bookmark.msgId === msgId)) return
    set({ bookmarks: previous.filter((bookmark) => bookmark.msgId !== msgId), error: null })
    try {
      await deleteSharedBookmark(msgId)
    } catch (error) {
      set({
        bookmarks: previous,
        error: error instanceof Error ? error.message : 'Unable to remove shared reference',
      })
    }
  },

  isBookmarked: (msgId) => get().bookmarks.some((bookmark) => bookmark.msgId === msgId),
}))
