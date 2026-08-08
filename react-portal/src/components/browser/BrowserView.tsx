import { useEffect, useRef, useState, useCallback } from 'react'
import { uploadFile } from '../../api/client'
import { sendChatMessage } from '../../api/chat'
import { createEvidence, type AicivEvidence } from '../../api/evidence'
import { AUTH_TOKEN_KEY } from '../../utils/constants'
import './BrowserView.css'

const BROWSER_W = 1280
const BROWSER_H = 800

interface LogEntry {
  action: string
  [key: string]: unknown
}

type ControlOwner = 'agent' | 'human'

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode browser screenshot')), 'image/png', 0.95)
  })
}

export function BrowserView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)
  const currentUrlRef = useRef('about:blank')
  const [connected, setConnected] = useState(false)
  const [currentUrl, setCurrentUrl] = useState('about:blank')
  const [urlInput, setUrlInput] = useState('')
  const [title, setTitle] = useState('')
  const [controlOwner, setControlOwner] = useState<ControlOwner>('agent')
  const [log, setLog] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [capturing, setCapturing] = useState(false)
  const [lastEvidence, setLastEvidence] = useState<AicivEvidence | null>(null)
  const [surfaceMessage, setSurfaceMessage] = useState<string | null>(null)

  const humanControl = controlOwner === 'human'

  const setPageUrl = useCallback((url: string) => {
    currentUrlRef.current = url
    setCurrentUrl(url)
  }, [])

  const drawFrame = useCallback((b64: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = `data:image/jpeg;base64,${b64}`
  }, [])

  useEffect(() => {
    disposedRef.current = false
    const legacy = localStorage.getItem(AUTH_TOKEN_KEY)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const suffix = legacy ? `?token=${encodeURIComponent(legacy)}` : ''
    const wsUrl = `${protocol}//${window.location.host}/ws/browser${suffix}`

    const scheduleReconnect = () => {
      if (disposedRef.current || reconnectRef.current) return
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null
        connect()
      }, 3000)
    }

    const connect = () => {
      if (disposedRef.current) return
      setStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (disposedRef.current) return
        setConnected(true)
        setStatus('live')
      }

      ws.onclose = (event) => {
        if (disposedRef.current) return
        setConnected(false)
        setStatus('error')
        if (event.code === 4401) {
          window.dispatchEvent(new CustomEvent('aiciv:auth-expired', { detail: { status: 401, path: '/ws/browser' } }))
          return
        }
        scheduleReconnect()
      }

      ws.onerror = () => {
        if (!disposedRef.current) setStatus('error')
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'frame') {
            drawFrame(msg.data)
            if (msg.url && msg.url !== currentUrlRef.current) setPageUrl(msg.url)
            if (msg.title) setTitle(msg.title)
          } else if (msg.type === 'log') {
            setLog(prev => [msg.entry, ...prev].slice(0, 50))
          }
        } catch {
          // Ignore malformed upstream browser frames/log entries.
        }
      }
    }

    connect()
    return () => {
      disposedRef.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      reconnectRef.current = null
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [drawFrame, setPageUrl])

  const sendWs = useCallback((cmd: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(cmd))
  }, [])

  const navigate = useCallback(() => {
    if (!urlInput.trim()) return
    sendWs({ action: 'navigate', url: urlInput.trim() })
  }, [urlInput, sendWs])

  const handoff = useCallback(() => {
    setControlOwner(owner => {
      const next: ControlOwner = owner === 'agent' ? 'human' : 'agent'
      setLog(prev => [{ action: 'control_handoff', from: owner, to: next, at: new Date().toISOString() }, ...prev].slice(0, 50))
      setSurfaceMessage(next === 'human'
        ? 'You have direct browser control. The AICIV still sees the shared page state.'
        : 'Control returned to the AICIV. Your clicks stop here until you take control again.')
      return next
    })
  }, [])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!humanControl || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * BROWSER_W
    const y = ((e.clientY - rect.top) / rect.height) * BROWSER_H
    sendWs({ action: 'click', x, y })
  }, [humanControl, sendWs])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!humanControl) return
    e.preventDefault()
    sendWs({ action: 'scroll', deltaY: e.deltaY })
  }, [humanControl, sendWs])

  const captureEvidence = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || capturing || !connected) return
    setCapturing(true)
    setSurfaceMessage(null)
    try {
      const blob = await canvasBlob(canvas)
      const file = new File([blob], `browser-evidence-${Date.now()}.png`, { type: 'image/png' })
      const upload = await uploadFile(file)
      if (!upload.ok) throw new Error('Portal upload did not accept screenshot')
      const saved = await createEvidence({
        artifactUrl: upload.url,
        pageUrl: currentUrlRef.current,
        title: title || currentUrlRef.current,
      })
      setLastEvidence(saved.evidence)
      setSurfaceMessage('Evidence saved to the shared AICIV workspace. It is not a completion receipt by itself.')
      setLog(prev => [{ action: 'evidence_saved', evidence_id: saved.evidence.id, url: currentUrlRef.current }, ...prev].slice(0, 50))
    } catch (error) {
      setSurfaceMessage(error instanceof Error ? error.message : 'Evidence capture failed')
    } finally {
      setCapturing(false)
    }
  }, [capturing, connected, title])

  const askAicivAboutPage = useCallback(async () => {
    setSurfaceMessage(null)
    try {
      const evidenceLine = lastEvidence ? `\nShared evidence: ${lastEvidence.id} (${lastEvidence.artifactUrl})` : ''
      await sendChatMessage(
        `[BROWSER CONTEXT]\nPage: ${title || '(untitled)'}\nURL: ${currentUrlRef.current}${evidenceLine}\n\nPlease inspect this shared browser context and tell me what is important, what you notice, and what you recommend next.`,
      )
      setSurfaceMessage('Browser context delivered to the primary AICIV. No downstream action is assumed complete.')
    } catch (error) {
      setSurfaceMessage(error instanceof Error ? error.message : 'Could not deliver browser context')
    }
  }, [lastEvidence, title])

  const statusColor = status === 'live' ? 'var(--status-success)' : status === 'error' ? 'var(--status-error)' : 'var(--status-warning)'
  const statusLabel = status === 'live' ? 'Live' : status === 'error' ? 'Reconnecting…' : 'Connecting…'

  return (
    <div className="browser-view">
      <div className="browser-toolbar">
        <div className="browser-status-dot" style={{ background: statusColor }} title={statusLabel} />
        <form className="browser-url-form" onSubmit={e => { e.preventDefault(); navigate() }}>
          <input className="browser-url-input" type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://…" spellCheck={false} />
          <button className="browser-go-btn" type="submit">Go</button>
        </form>
        <div className="browser-current-url" title={currentUrl}>{title || currentUrl}</div>
        <button className="browser-evidence-btn" onClick={() => void captureEvidence()} disabled={!connected || capturing} title="Save the current shared viewport as evidence">
          {capturing ? 'Saving…' : '📸 Evidence'}
        </button>
        <button className="browser-ask-btn" onClick={() => void askAicivAboutPage()} disabled={!connected}>Ask AICIV</button>
        <button className={`browser-control-btn ${humanControl ? 'active' : ''}`} onClick={handoff} title={humanControl ? 'Hand browser control back to the AICIV' : 'Take direct browser control'}>
          {humanControl ? '↪ Hand back' : '🕹 Take control'}
        </button>
      </div>

      {surfaceMessage && <div className="browser-surface-message" role="status">{surfaceMessage}</div>}

      <div className="browser-body">
        <div className="browser-canvas-wrap">
          {!connected && <div className="browser-overlay"><div className="browser-overlay-msg">{status === 'connecting' ? 'Connecting to browser…' : 'Browser offline — reconnecting…'}</div></div>}
          <canvas ref={canvasRef} className={`browser-canvas ${humanControl ? 'human-mode' : ''}`} width={BROWSER_W} height={BROWSER_H} onClick={handleCanvasClick} onWheel={handleWheel} />
          <div className={`browser-control-owner browser-control-owner-${controlOwner}`}>{humanControl ? 'Human has control' : 'AICIV has control'}</div>
        </div>

        <div className="browser-log">
          <div className="browser-log-header">Shared action & evidence log</div>
          {log.length === 0 ? <div className="browser-log-empty">No actions yet</div> : log.map((entry, i) => (
            <div key={i} className="browser-log-entry">
              <span className="browser-log-action">{entry.action}</span>
              {entry.url != null && <span className="browser-log-detail">{String(entry.url).slice(0, 48)}</span>}
              {entry.evidence_id != null && <span className="browser-log-detail">{String(entry.evidence_id)}</span>}
              {entry.x != null && <span className="browser-log-detail">({Math.round(entry.x as number)}, {Math.round(entry.y as number)})</span>}
              {entry.text != null && <span className="browser-log-detail">“{String(entry.text).slice(0, 24)}”</span>}
            </div>
          ))}
        </div>
      </div>

      {humanControl && <div className="browser-control-hint">🕹 You have direct control. Click/scroll events go to the shared browser; use <strong>Hand back</strong> when the AICIV should continue.</div>}
    </div>
  )
}
