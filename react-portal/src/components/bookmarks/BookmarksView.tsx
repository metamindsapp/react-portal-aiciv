import { useEffect } from 'react'
import { useBookmarkStore } from '../../stores/bookmarkStore'
import { formatRelativeTime } from '../../utils/time'
import { EmptyState } from '../common/EmptyState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import './BookmarksView.css'

export function BookmarksView() {
  const { bookmarks, loaded, loading, error, load, remove } = useBookmarkStore()

  useEffect(() => {
    if (!loaded) void load()
  }, [load, loaded])

  if (loading && !loaded) {
    return <div className="bookmarks-empty"><LoadingSpinner size={32} /></div>
  }

  if (bookmarks.length === 0) {
    return (
      <div className="bookmarks-empty">
        <EmptyState
          title="No shared references yet"
          description="Save an important conversation message and it will be available across Portal devices instead of living only in this browser."
        />
      </div>
    )
  }

  return (
    <div className="bookmarks-view">
      <h2 className="bookmarks-title">Shared References</h2>
      <p className="bookmarks-subtitle">
        {bookmarks.length} saved message{bookmarks.length !== 1 ? 's' : ''} · shared with this AICIV workspace
      </p>
      {error && <div role="status" className="bookmarks-error">{error}</div>}
      <div className="bookmarks-list">
        {bookmarks.map(b => (
          <div key={b.msgId} className="bookmark-card">
            <div className="bookmark-header">
              <span className={`bookmark-role bookmark-role-${b.role}`}>
                {b.role === 'user' ? 'Human' : 'AICIV'}
              </span>
              <span className="bookmark-time">{formatRelativeTime(b.timestamp)}</span>
            </div>
            <p className="bookmark-text">{b.text}</p>
            {b.note && <p className="bookmark-note">{b.note}</p>}
            {b.tags && b.tags.length > 0 && (
              <div className="bookmark-tags">
                {b.tags.map(tag => <span key={tag}>{tag}</span>)}
              </div>
            )}
            <button
              className="bookmark-remove"
              onClick={() => void remove(b.msgId)}
              title="Remove shared reference"
              aria-label="Remove shared reference"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
