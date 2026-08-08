import { useEffect, useRef, useState } from 'react'
import { AUTH_TOKEN_KEY } from '../../utils/constants'
import './TerminalView.css'

export function TerminalView() {
  const [content, setContent] = useState('')
  const [connected, setConnected] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let unmounted = false

    function connect() {
      const legacy = localStorage.getItem(AUTH_TOKEN_KEY)
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const suffix = legacy ? `?token=${encodeURIComponent(legacy)}` : ''
      const url = `${proto}//${window.location.host}/ws/terminal${suffix}`

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws
        ws.onopen = () => {
          if (!unmounted) setConnected(true)
        }
        ws.onmessage = (event) => {
          if (!unmounted) setContent(event.data)
        }
        ws.onclose = (event) => {
          if (unmounted) return
          setConnected(false)
          if (event.code === 4401) {
            window.dispatchEvent(new CustomEvent('aiciv:auth-expired', { detail: { status: 401, path: '/ws/terminal' } }))
            return
          }
          reconnectRef.current = setTimeout(connect, 2000)
        }
        ws.onerror = () => ws.close()
      } catch {
        if (!unmounted) reconnectRef.current = setTimeout(connect, 2000)
      }
    }

    connect()
    return () => {
      unmounted = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [content])

  return (
    <div className="terminal-view">
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <span className={`terminal-status ${connected ? 'terminal-connected' : 'terminal-disconnected'}`}>
          {connected ? '\u{1F7E2} connected' : '\u{1F534} disconnected'}
        </span>
      </div>
      <pre ref={preRef} className="terminal-output">{content || 'Connecting to terminal...'}</pre>
    </div>
  )
}
