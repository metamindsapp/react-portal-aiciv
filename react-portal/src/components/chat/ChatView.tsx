import { useCallback, useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { uploadFile } from '../../api/client'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SearchPanel } from './SearchPanel'
import { ArtifactPanel } from './ArtifactPanel'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { EmptyState } from '../common/EmptyState'
import './ChatView.css'

export function ChatView() {
  const messages = useChatStore(s => s.messages)
  const loading = useChatStore(s => s.loading)
  const sending = useChatStore(s => s.sending)
  const focusMessageId = useChatStore(s => s.focusMessageId)
  const setFocusMessageId = useChatStore(s => s.setFocusMessageId)
  const loadHistory = useChatStore(s => s.loadHistory)
  const send = useChatStore(s => s.send)
  const react = useChatStore(s => s.react)
  const connectWs = useChatStore(s => s.connectWs)
  const disconnectWs = useChatStore(s => s.disconnectWs)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [artifactContent, setArtifactContent] = useState('')
  const [artifactLanguage, setArtifactLanguage] = useState('')
  const [artifactOpen, setArtifactOpen] = useState(false)

  const handlePreviewArtifact = useCallback((content: string, language: string) => {
    setArtifactContent(content)
    setArtifactLanguage(language)
    setArtifactOpen(true)
  }, [])

  const handleCloseArtifact = useCallback(() => {
    setArtifactOpen(false)
  }, [])

  useEffect(() => {
    loadHistory()
    connectWs()
    return () => disconnectWs()
  }, [loadHistory, connectWs, disconnectWs])

  const handleUpload = async (file: File) => {
    try {
      const res = await uploadFile(file)
      if (res.ok) {
        send(`[Uploaded file: ${res.filename}](${res.url})`)
      }
    } catch {
      // Upload errors will move into the shared Portal error surface in a later tranche.
    }
  }

  const { matchCount, highlightIds } = useMemo(() => {
    const ids = new Set<string>()
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      for (const msg of messages) {
        if (msg.text.toLowerCase().includes(q)) ids.add(msg.id)
      }
    }
    if (focusMessageId) ids.add(focusMessageId)
    return { matchCount: searchQuery.trim() ? ids.size : 0, highlightIds: ids }
  }, [focusMessageId, messages, searchQuery])

  return (
    <div className={`chat-view ${artifactOpen ? 'chat-with-artifact' : ''}`}>
      <div className="chat-main-area">
        <div className="chat-header-bar">
          <div className="chat-header-actions">
            <span className="chat-header-hint">Live Presence is available globally in the Portal header.</span>
            <button
              className={`chat-search-toggle ${showSearch ? 'chat-search-toggle-active' : ''}`}
              onClick={() => {
                setShowSearch(v => !v)
                if (showSearch) setSearchQuery('')
              }}
              title="Search messages"
              aria-label="Search conversation"
            >
              {'\u{1F50D}'}
            </button>
          </div>
        </div>
        {showSearch && (
          <SearchPanel
            onSearch={setSearchQuery}
            matchCount={matchCount}
            onClose={() => { setShowSearch(false); setSearchQuery('') }}
          />
        )}
        {loading && messages.length === 0 ? (
          <div className="chat-loading">
            <LoadingSpinner size={32} />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <EmptyState
              title="No messages yet"
              description="Send a message to start a conversation with your CIV"
            />
          </div>
        ) : (
          <MessageList
            messages={messages}
            onReact={react}
            highlightIds={highlightIds}
            focusMessageId={focusMessageId}
            onFocusHandled={() => window.setTimeout(() => setFocusMessageId(null), 1800)}
            onPreviewArtifact={handlePreviewArtifact}
          />
        )}
        <ChatInput onSend={send} onUpload={handleUpload} sending={sending} />
      </div>
      {artifactOpen && (
        <ArtifactPanel
          content={artifactContent}
          language={artifactLanguage}
          onClose={handleCloseArtifact}
        />
      )}
    </div>
  )
}
