import { apiGet } from '../../api/client'
import { usePortalResource } from '../../hooks/usePortalResource'
import { formatUptime } from '../../utils/time'
import { LoadingSpinner } from '../common/LoadingSpinner'
import './StatusView.css'

interface StatusData {
  civ: string
  uptime: number
  tmux_session: string
  tmux_alive: boolean
  claude_running: boolean
  tg_bot_running: boolean
  ctx_pct: number | null
  version: string
  timestamp: number
}

interface BoopStatus {
  running: boolean
  pid?: number
}

interface AuthStatus {
  authenticated: boolean
  account?: string | null
  expires_at?: number | null
  subscription?: string | null
}

export function StatusView() {
  const statusResource = usePortalResource<StatusData>('status:primary', () => apiGet('/api/status'), { ttlMs: 5000, refreshMs: 15_000 })
  const boopResource = usePortalResource<BoopStatus>('status:boop', () => apiGet('/api/boop-status'), { ttlMs: 5000, refreshMs: 15_000 })
  const authResource = usePortalResource<AuthStatus>('status:claude-auth', () => apiGet('/api/auth/status'), { ttlMs: 5000, refreshMs: 15_000 })

  const status = statusResource.data
  const boop = boopResource.data
  const auth = authResource.data
  const loading = statusResource.loading && boopResource.loading && authResource.loading

  if (loading) return <div className="status-loading"><LoadingSpinner size={32} /></div>

  const indicator = (ok: boolean | undefined | null) => ok ? '\u{1F7E2}' : '\u{1F534}'
  const ctxPct = status?.ctx_pct ?? 0
  const hasStaleError = Boolean(statusResource.error || boopResource.error || authResource.error)

  return (
    <div className="status-view">
      <div className="status-title-row">
        <div>
          <h2 className="status-title">System Health</h2>
          <p className="status-subtitle">Meaning first; diagnostics remain inspectable.</p>
        </div>
        <button
          type="button"
          className="status-refresh"
          onClick={() => void Promise.allSettled([statusResource.refresh(), boopResource.refresh(), authResource.refresh()])}
        >
          Refresh
        </button>
      </div>
      {hasStaleError && (
        <div className="status-stale-warning" role="status">
          One or more health sources could not refresh. Last known values remain visible; use the correlated error notice for diagnostics.
        </div>
      )}
      <div className="status-grid">
        <div className="status-card">
          <h3 className="status-card-title">Primary AICIV</h3>
          <div className="status-card-body">
            <div className="status-row"><span className="status-label">Name</span><span className="status-value">{status?.civ ?? '—'}</span></div>
            <div className="status-row"><span className="status-label">Availability</span><span className="status-value">{indicator(status?.tmux_alive && status?.claude_running)} {status?.tmux_alive && status?.claude_running ? 'ready for work' : 'cannot accept normal work'}</span></div>
            <div className="status-row"><span className="status-label">Uptime</span><span className="status-value">{status ? formatUptime(status.uptime) : '—'}</span></div>
            <div className="status-row"><span className="status-label">Version</span><span className="status-value">{status?.version ?? '—'}</span></div>
          </div>
        </div>

        <div className="status-card">
          <h3 className="status-card-title">Runtime Detail</h3>
          <div className="status-card-body">
            <div className="status-row"><span className="status-label">tmux</span><span className="status-value">{indicator(status?.tmux_alive)} {status?.tmux_alive ? 'alive' : 'down'}</span></div>
            <div className="status-row"><span className="status-label">Claude</span><span className="status-value">{indicator(status?.claude_running)} {status?.claude_running ? 'running' : 'stopped'}</span></div>
            <div className="status-row"><span className="status-label">Telegram</span><span className="status-value">{indicator(status?.tg_bot_running)} {status?.tg_bot_running ? 'running' : 'stopped'}</span></div>
            <div className="status-row"><span className="status-label">tmux session</span><span className="status-value status-mono">{status?.tmux_session ?? '—'}</span></div>
          </div>
        </div>

        <div className="status-card">
          <h3 className="status-card-title">Context Window</h3>
          <div className="status-card-body">
            <div className="status-ctx-bar"><div className="status-ctx-fill" style={{ width: `${Math.min(ctxPct, 100)}%` }} /></div>
            <div className="status-row"><span className="status-label">Usage</span><span className="status-value">{ctxPct > 0 ? `${ctxPct.toFixed(1)}%` : 'N/A'}</span></div>
          </div>
        </div>

        <div className="status-card">
          <h3 className="status-card-title">Background Work</h3>
          <div className="status-card-body">
            <div className="status-row"><span className="status-label">BOOP</span><span className="status-value">{indicator(boop?.running)} {boop?.running ? 'running' : 'stopped'}</span></div>
          </div>
        </div>

        <div className="status-card">
          <h3 className="status-card-title">Claude Account</h3>
          <div className="status-card-body">
            <div className="status-row"><span className="status-label">Status</span><span className="status-value">{auth ? (auth.authenticated ? '\uD83D\uDFE2 authenticated' : '\uD83D\uDD34 not authenticated') : '—'}</span></div>
            {auth?.account && <div className="status-row"><span className="status-label">Account</span><span className="status-value">{auth.account}</span></div>}
            {auth?.subscription && <div className="status-row"><span className="status-label">Subscription</span><span className="status-value">{auth.subscription}</span></div>}
            {auth?.expires_at && <div className="status-row"><span className="status-label">Expires</span><span className="status-value">{new Date(auth.expires_at).toLocaleString()}</span></div>}
          </div>
        </div>
      </div>
    </div>
  )
}
