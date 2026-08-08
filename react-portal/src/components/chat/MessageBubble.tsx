import { useState, useRef, useCallback, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../../utils/cn'
import { formatRelativeTime } from '../../utils/time'
import { useBookmarkStore } from '../../stores/bookmarkStore'
import type { ChatMessage } from '../../types/chat'
import './MessageBubble.css'

const REACTION_EMOJIS: { emoji: string; name: string; weight: number }[] = [
  { emoji: '\u{1F44D}', name: 'thumbs-up', weight: 1 },
  { emoji: '\u{1F44E}', name: 'thumbs-down', weight: -1 },
  { emoji: '\u{1F680}', name: 'rocket', weight: 2 },
  { emoji: '\u{1F525}', name: 'fire', weight: 2 },
  { emoji: '\u{2705}', name: 'check', weight: 1 },
  { emoji: '\u{1F4A5}', name: 'explosion', weight: 2 },
  { emoji: '\u{1F92F}', name: 'mind-blown', weight: 3 },
  { emoji: '\u{1F4AA}', name: 'muscle', weight: 1 },
  { emoji: '\u{1F3AF}', name: 'bullseye', weight: 2 },
  { emoji: '\u{1F48E}', name: 'gem', weight: 2 },
  { emoji: '\u{2764}\u{FE0F}', name: 'heart', weight: 5 },
  { emoji: '\u{1F60D}', name: 'heart-eyes', weight: 10 },
  { emoji: '\u{1F622}', name: 'sad', weight: -1 },
  { emoji: '\u{1F610}', name: 'neutral', weight: 0 },
]

interface CodeBlock {
  language: string
  content: string
  fullMatch: string
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const regex = /```(\w+)?\n([\s\S]*?)```/g
  const blocks: CodeBlock[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || 'code',
      content: match[2].trimEnd(),
      fullMatch: match[0],
    })
  }
  return blocks
}

interface MessageBubbleProps {
  message: ChatMessage
  onReact: (emoji: string, action: 'add' | 'remove') => void
  highlight?: boolean
  onPreviewArtifact?: (content: string, language: string) => void
}

export const MessageBubble = memo(function MessageBubble({ message, onReact, highlight, onPreviewArtifact }: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUser = message.role === 'user'
  const isBookmarked = useBookmarkStore(s => s.isBookmarked(message.id))
  const addBookmark = useBookmarkStore(s => s.add)
  const removeBookmark = useBookmarkStore(s => s.remove)
  const codeBlocks = extractCodeBlocks(message.text)
  const reactions = message.reactions || []

  const toggleBookmark = () => {
    if (isBookmarked) void removeBookmark(message.id)
    else void addBookmark(message)
  }

  const handleMouseEnter = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setShowReactions(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    hideTimer.current = setTimeout(() => setShowReactions(false), 300)
  }, [])

  return (
    <div
      id={`message-${message.id}`}
      className={cn('msg-row', isUser && 'msg-row-user', highlight && 'msg-row-highlight')}
    >
      <div
        className={cn('msg-bubble', isUser ? 'msg-user' : 'msg-assistant')}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="msg-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              code: ({ children, className }) => {
                const isBlock = className?.startsWith('language-')
                return isBlock ? (
                  <pre className="msg-code-block"><code>{children}</code></pre>
                ) : (
                  <code className="msg-code-inline">{children}</code>
                )
              },
            }}
          >
            {message.text}
          </ReactMarkdown>
        </div>

        {codeBlocks.length > 0 && onPreviewArtifact && (
          <div className="msg-preview-buttons">
            {codeBlocks.map((block, i) => (
              <button
                key={i}
                className="msg-preview-btn"
                onClick={() => onPreviewArtifact(block.content, block.language)}
                title={`Preview ${block.language} in side panel`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Preview{codeBlocks.length > 1 ? ` (${block.language})` : ''}
              </button>
            ))}
          </div>
        )}

        {reactions.length > 0 && (
          <div className="msg-reaction-badges" aria-label="Shared reactions">
            {reactions.map(reaction => (
              <button
                key={reaction.emoji}
                type="button"
                className={cn('msg-reaction-badge', reaction.mine && 'msg-reaction-badge-mine')}
                onClick={() => onReact(reaction.emoji, reaction.mine ? 'remove' : 'add')}
                title={reaction.mine ? 'Remove your reaction' : 'Add this reaction'}
              >
                {reaction.emoji}
                <span className="msg-reaction-score">{reaction.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="msg-meta">
          <span className="msg-time">{formatRelativeTime(message.timestamp)}</span>
          {isBookmarked && <span className="msg-shared-reference" title="Saved as a shared AICIV reference">Shared reference</span>}
        </div>

        {showReactions && (
          <div className="msg-actions">
            <button
              className={cn('msg-bookmark-btn', isBookmarked && 'msg-bookmark-active')}
              onClick={toggleBookmark}
              title={isBookmarked ? 'Remove shared reference' : 'Save as shared reference'}
              aria-pressed={isBookmarked}
            >
              {isBookmarked ? '\u{1F4CC}' : '\u{1F4CB}'}
            </button>
            <div className="msg-reactions-picker">
              {REACTION_EMOJIS.map(reaction => {
                const existing = reactions.find(item => item.emoji === reaction.emoji)
                return (
                  <button
                    key={reaction.emoji}
                    className={cn('msg-reaction-btn', existing?.mine && 'msg-reaction-btn-active')}
                    onClick={() => onReact(reaction.emoji, existing?.mine ? 'remove' : 'add')}
                    title={`${existing?.mine ? 'Remove' : 'Add'} ${reaction.name}`}
                    aria-pressed={Boolean(existing?.mine)}
                  >
                    {reaction.emoji}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
