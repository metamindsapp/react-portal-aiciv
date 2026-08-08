import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchChatHistory, sendChatMessage } from '../../api/chat'
import { fetchDocs } from '../../api/docs'
import { fetchPresenceJobs } from '../../api/presence'
import { fetchAicivProjects } from '../../api/projects'
import {
  docCommandEntries,
  jobCommandEntries,
  messageCommandEntries,
  projectCommandEntries,
  rankCommandEntries,
  routeCommandEntries,
  type CommandEntry,
} from '../../search/commandPalette'
import { useChatStore } from '../../stores/chatStore'
import { useDocsStore } from '../../stores/docsStore'
import { useProjectsStore } from '../../stores/projectsStore'
import './CommandPalette.css'

type Selectable =
  | { type: 'ask'; id: 'ask-aiciv' }
  | { type: 'entry'; id: string; entry: CommandEntry }

const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])

function entryIcon(kind: CommandEntry['kind']): string {
  switch (kind) {
    case 'route': return '↗'
    case 'project': return '◆'
    case 'job': return '◉'
    case 'doc': return '▤'
    case 'message': return '◌'
  }
}

function entryKindLabel(kind: CommandEntry['kind']): string {
  switch (kind) {
    case 'route': return 'Portal'
    case 'project': return 'Project'
    case 'job': return 'Durable work'
    case 'doc': return 'Doc'
    case 'message': return 'Conversation'
  }
}

export function CommandPalette() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const loadedAtRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dynamicEntries, setDynamicEntries] = useState<CommandEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceWarning, setSourceWarning] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [sendingAsk, setSendingAsk] = useState(false)

  const staticEntries = useMemo(() => routeCommandEntries(), [])

  const loadIndex = useCallback(async (force = false) => {
    if (!force && Date.now() - loadedAtRef.current < 30_000) return
    setLoading(true)
    setSourceWarning(null)

    const [projectsResult, jobsResult, docsResult, chatResult] = await Promise.allSettled([
      fetchAicivProjects(),
      fetchPresenceJobs(75),
      fetchDocs(),
      fetchChatHistory(200),
    ])

    const next: CommandEntry[] = []
    const unavailable: string[] = []

    if (projectsResult.status === 'fulfilled') {
      next.push(...projectCommandEntries(projectsResult.value.projects || []))
    } else {
      unavailable.push('Projects')
    }

    if (jobsResult.status === 'fulfilled') {
      next.push(...jobCommandEntries(jobsResult.value.jobs || []))
    } else {
      unavailable.push('durable work')
    }

    if (docsResult.status === 'fulfilled') {
      next.push(...docCommandEntries(Array.isArray(docsResult.value) ? docsResult.value : []))
    } else {
      unavailable.push('Docs')
    }

    if (chatResult.status === 'fulfilled') {
      next.push(...messageCommandEntries(chatResult.value.messages || []))
    } else {
      unavailable.push('conversation history')
    }

    setDynamicEntries(next)
    loadedAtRef.current = Date.now()
    setLoading(false)
    setSourceWarning(unavailable.length ? `Some search sources are unavailable: ${unavailable.join(', ')}.` : null)
  }, [])

  const openPalette = useCallback(() => {
    setOpen(true)
    setActiveIndex(0)
    void loadIndex()
  }, [loadIndex])

  const closePalette = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
    setSendingAsk(false)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (open) closePalette()
        else openPalette()
        return
      }
      if (open && event.key === 'Escape') {
        event.preventDefault()
        closePalette()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePalette, open, openPalette])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const ranked = useMemo(
    () => rankCommandEntries([...staticEntries, ...dynamicEntries], query, 18),
    [dynamicEntries, query, staticEntries],
  )

  const selectable = useMemo<Selectable[]>(() => {
    const items: Selectable[] = []
    if (query.trim().length >= 2) items.push({ type: 'ask', id: 'ask-aiciv' })
    items.push(...ranked.map(entry => ({ type: 'entry' as const, id: entry.id, entry })))
    return items
  }, [query, ranked])

  useEffect(() => {
    setActiveIndex(index => Math.min(index, Math.max(0, selectable.length - 1)))
  }, [selectable.length])

  const activate = useCallback(async (item: Selectable) => {
    if (item.type === 'ask') {
      const message = query.trim()
      if (!message || sendingAsk) return
      setSendingAsk(true)
      try {
        const receipt = await sendChatMessage(message)
        if (!receipt.ok) {
          setSourceWarning('Portal did not accept that AICIV message.')
          return
        }
        closePalette()
        navigate('/')
      } catch {
        setSourceWarning('Could not deliver that message to the primary AICIV.')
      } finally {
        setSendingAsk(false)
      }
      return
    }

    const entry = item.entry
    switch (entry.kind) {
      case 'route':
        if (entry.route) navigate(entry.route)
        break
      case 'project':
        if (entry.project) {
          useProjectsStore.getState().selectProject(entry.project.projectId)
          navigate('/projects')
        }
        break
      case 'doc':
        if (entry.doc) {
          useDocsStore.getState().setSelectedDoc(entry.doc)
          navigate('/docs')
        }
        break
      case 'message':
        if (entry.messageId) useChatStore.getState().setFocusMessageId(entry.messageId)
        navigate('/')
        break
      case 'job':
        if (entry.job) {
          const destination = entry.job.status === 'waiting' || TERMINAL_JOB_STATUSES.has(entry.job.status)
            ? '/inbox'
            : '/now'
          navigate(destination)
        }
        break
    }
    closePalette()
  }, [closePalette, navigate, query, sendingAsk])

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => Math.min(index + 1, selectable.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = selectable[activeIndex]
      if (item) void activate(item)
    }
  }

  return (
    <>
      <button
        type="button"
        className="command-palette-trigger"
        onClick={openPalette}
        title="Search Portal or ask your AICIV (Ctrl/Cmd-K)"
        aria-label="Open command palette"
      >
        <span aria-hidden="true">⌕</span>
        <span className="command-palette-trigger-label">Search</span>
        <kbd>⌘K</kbd>
      </button>

      {open && (
        <div className="command-palette-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) closePalette()
        }}>
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Portal command palette"
          >
            <div className="command-palette-input-wrap">
              <span className="command-palette-search-icon" aria-hidden="true">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={event => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search everything or ask your AICIV…"
                aria-label="Search Portal or ask AICIV"
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <span className="command-palette-loading">indexing…</span>}
            </div>

            {sourceWarning && <div className="command-palette-warning">{sourceWarning}</div>}

            <div className="command-palette-results" role="listbox">
              {selectable.length === 0 ? (
                <div className="command-palette-empty">No matching Portal objects.</div>
              ) : selectable.map((item, index) => {
                if (item.type === 'ask') {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`command-palette-result command-palette-ask ${index === activeIndex ? 'active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void activate(item)}
                      disabled={sendingAsk}
                    >
                      <span className="command-palette-result-icon">✦</span>
                      <span className="command-palette-result-copy">
                        <strong>{sendingAsk ? 'Sending to AICIV…' : `Ask AICIV: “${query.trim()}”`}</strong>
                        <small>Send directly into the primary conversation</small>
                      </span>
                      <span className="command-palette-kind">Action</span>
                    </button>
                  )
                }

                const entry = item.entry
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`command-palette-result ${index === activeIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void activate(item)}
                  >
                    <span className="command-palette-result-icon">{entryIcon(entry.kind)}</span>
                    <span className="command-palette-result-copy">
                      <strong>{entry.title}</strong>
                      <small>{entry.subtitle}</small>
                    </span>
                    <span className="command-palette-kind">{entryKindLabel(entry.kind)}</span>
                  </button>
                )
              })}
            </div>

            <footer className="command-palette-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>↵</kbd> open</span>
              <span><kbd>esc</kbd> close</span>
              <button type="button" onClick={() => void loadIndex(true)}>Refresh index</button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
