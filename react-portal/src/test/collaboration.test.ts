import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookmarkStore } from '../stores/bookmarkStore'
import { useChatStore } from '../stores/chatStore'
import type { ChatMessage } from '../types/chat'

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
  useBookmarkStore.setState({ bookmarks: [], loaded: false, loading: false, error: null })
  useChatStore.setState({ messages: [], error: null })
  localStorage.setItem('aiciv-portal-token', 'token')
})

describe('shared bookmark store', () => {
  it('loads server bookmarks and migrates legacy browser bookmarks', async () => {
    localStorage.setItem('aiciv-bookmarks', JSON.stringify([
      { msgId: 'legacy-1', text: 'legacy idea', role: 'user', timestamp: 10, savedAt: 1000 },
    ]))

    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        version: 1,
        bookmarks: [{ msgId: 'server-1', text: 'server idea', role: 'assistant', timestamp: 20, savedAt: '2026-08-08T10:00:00Z' }],
        reactions: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        bookmark: { msgId: 'legacy-1', text: 'legacy idea', role: 'user', timestamp: 10, savedAt: '1970-01-01T00:00:01.000Z' },
        semanticReceipt: 'shared_reference_saved',
      }, 201))

    await useBookmarkStore.getState().load()
    expect(useBookmarkStore.getState().bookmarks.map(b => b.msgId).sort()).toEqual(['legacy-1', 'server-1'])
    expect(localStorage.getItem('aiciv-bookmarks')).toBeNull()
  })

  it('optimistically saves then confirms a new shared reference', async () => {
    const message: ChatMessage = { id: 'm1', text: 'remember this', role: 'assistant', timestamp: 50 }
    mockFetch.mockResolvedValueOnce(jsonResponse({
      bookmark: { msgId: 'm1', text: 'remember this', role: 'assistant', timestamp: 50, savedAt: '2026-08-08T12:00:00Z' },
      semanticReceipt: 'shared_reference_saved',
    }, 201))

    await useBookmarkStore.getState().add(message)
    expect(useBookmarkStore.getState().isBookmarked('m1')).toBe(true)
    expect(useBookmarkStore.getState().bookmarks[0].savedAt).toBe('2026-08-08T12:00:00Z')
  })
})

describe('shared reaction state', () => {
  it('toggles a reaction and persists the shared aggregate after sentiment append', async () => {
    useChatStore.setState({
      messages: [{ id: 'm9', text: 'ship it', role: 'assistant', timestamp: 1, reactions: [] }],
    })
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, sentiment: 'positive' }))
      .mockResolvedValueOnce(jsonResponse({ msgId: 'm9', reactions: [{ emoji: '🔥', count: 1, mine: true }] }))

    await useChatStore.getState().react('m9', '🔥', 'add', 'ship it', 'assistant')
    expect(useChatStore.getState().messages[0].reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }])

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, sentiment: 'positive' }))
      .mockResolvedValueOnce(jsonResponse({ msgId: 'm9', reactions: [] }))
    await useChatStore.getState().react('m9', '🔥', 'remove', 'ship it', 'assistant')
    expect(useChatStore.getState().messages[0].reactions).toEqual([])
  })
})
