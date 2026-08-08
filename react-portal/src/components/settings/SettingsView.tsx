import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { useIdentityStore } from '../../stores/identityStore'
import { toggleBoop } from '../../api/settings'
import { cn } from '../../utils/cn'
import type { Theme } from '../../types/settings'
import './SettingsView.css'

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return 'Unknown'
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) return 'Expired'
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const absolute = new Date(expiresAt).toLocaleString()
  return `${absolute} (${hours > 0 ? `${hours}h ` : ''}${minutes}m remaining)`
}

export function SettingsView() {
  const { theme, setTheme, quickfirePills, setQuickfirePills, boopEnabled, setBoopEnabled } = useSettingsStore()
  const authenticated = useAuthStore(s => s.authenticated)
  const expiresAt = useAuthStore(s => s.expiresAt)
  const sessionMode = useAuthStore(s => s.sessionMode)
  const logout = useAuthStore(s => s.logout)
  const { civName, humanName, status } = useIdentityStore()

  const handleThemeToggle = (t: Theme) => setTheme(t)

  const handleBoopToggle = async () => {
    const next = !boopEnabled
    try {
      await toggleBoop(next)
      setBoopEnabled(next)
    } catch {
      // The global correlated Error Center carries API failures.
    }
  }

  const handleRemovePill = (pill: string) => {
    setQuickfirePills(quickfirePills.filter(p => p !== pill))
  }

  const handleAddPill = () => {
    const val = prompt('Enter quickfire message:')
    if (val?.trim() && !quickfirePills.includes(val.trim())) {
      setQuickfirePills([...quickfirePills, val.trim()])
    }
  }

  return (
    <div className="settings-view">
      <h2 className="settings-title">Settings</h2>

      <section className="settings-section">
        <h3>Identity</h3>
        <div className="settings-info">
          <div className="settings-row">
            <span className="settings-label">CIV Name</span>
            <span className="settings-value">{civName || '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Human Name</span>
            <span className="settings-value">{humanName || '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Version</span>
            <span className="settings-value">{status?.version || '—'}</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3>Browser Security</h3>
        <div className="settings-info">
          <div className="settings-row">
            <span className="settings-label">Authentication</span>
            <span className="settings-value">
              {authenticated
                ? sessionMode === 'http_only_cookie'
                  ? 'Short-lived HttpOnly session'
                  : 'Authenticated'
                : 'Not authenticated'}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Session expires</span>
            <span className="settings-value">{authenticated ? formatExpiry(expiresAt) : '—'}</span>
          </div>
          <div className="settings-security-note">
            The long-lived Portal bootstrap credential is exchanged once. Normal browser HTTP/WebSocket traffic uses the short-lived same-origin session instead.
          </div>
          <button
            className="settings-logout"
            onClick={() => void logout()}
            disabled={!authenticated}
            title="Revoke this browser's server-side Portal session and return to login"
          >
            Revoke this browser session
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-toggle">
          {(['dark', 'light'] as Theme[]).map(t => (
            <button
              key={t}
              className={cn('theme-btn', theme === t && 'theme-btn-active')}
              onClick={() => handleThemeToggle(t)}
            >
              {t === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>BOOP</h3>
        <div className="settings-row">
          <span className="settings-label">Background tasks</span>
          <button
            className={cn('boop-toggle', boopEnabled && 'boop-toggle-on')}
            onClick={handleBoopToggle}
          >
            <span className="boop-toggle-thumb" />
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Quick Fire Messages</h3>
        <div className="pill-list">
          {quickfirePills.map((pill, i) => (
            <span key={`${i}-${pill}`} className="pill-item">
              {pill}
              <button className="pill-remove" onClick={() => handleRemovePill(pill)}>&times;</button>
            </span>
          ))}
          <button className="pill-add" onClick={handleAddPill}>+ Add</button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Resources</h3>
        <div className="settings-links">
          <a href="https://ai-civ.com" target="_blank" rel="noopener noreferrer" className="settings-link">
            AiCIV Platform
          </a>
          <a href="https://ai-civ.com/blog" target="_blank" rel="noopener noreferrer" className="settings-link">
            AiCIV Chronicles (Blog)
          </a>
        </div>
      </section>
    </div>
  )
}
