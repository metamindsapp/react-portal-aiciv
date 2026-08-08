import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type { Reaction } from '../types/chat'

export interface SharedBookmark {
  msgId: string
  text: string
  role: 'user' | 'assistant'
  timestamp: number
  savedAt: string
  tags?: string[]
  note?: string
}

export interface CollaborationState {
  version: number
  bookmarks: SharedBookmark[]
  reactions: Record<string, Reaction[]>
}

export function fetchCollaborationState(): Promise<CollaborationState> {
  return apiGet<CollaborationState>('/api/aiciv/collaboration')
}

export function createSharedBookmark(bookmark: Omit<SharedBookmark, 'savedAt'> & { savedAt?: string }) {
  return apiPost<{ bookmark: SharedBookmark; semanticReceipt: string }>('/api/aiciv/bookmarks', bookmark)
}

export function deleteSharedBookmark(messageId: string) {
  return apiDelete<{ msgId: string; removed: boolean }>(`/api/aiciv/bookmarks/${encodeURIComponent(messageId)}`)
}

export function persistReactionSummary(messageId: string, reactions: Reaction[]) {
  return apiPut<{ msgId: string; reactions: Reaction[] }>(
    `/api/aiciv/reactions/${encodeURIComponent(messageId)}`,
    { reactions },
  )
}
