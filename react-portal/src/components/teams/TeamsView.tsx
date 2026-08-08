import { useEffect, useMemo, useState } from 'react'
import { describePane, type PaneSemanticState } from '../../domain/teamSemantics'
import { useTeamsStore, type TmuxPane } from '../../stores/teamsStore'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { EmptyState } from '../common/EmptyState'
import './TeamsView.css'

function PaneCard({ pane }: { pane: TmuxPane }) {
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  const injectMessage = useTeamsStore(s => s.injectMessage)
  const semantic = useMemo(() => describePane(pane), [pane])

  const handleSend = async () => {
    const trimmed = msg.trim()
    if (!trimmed || sending) return
    setSending(true)
    const accepted = await injectMessage(pane.id, trimmed)
    if (accepted) setMsg('')
    setSending(false)
  }

  return (
    <article className={`pane-card pane-card-${semantic.state}`}>
      <div className="pane-header">
        <div className="pane-identity">
          <span className={`pane-state pane-state-${semantic.state}`}>{semantic.label}</span>
          <span className="pane-title">{pane.title || pane.id}</span>
        </div>
        <span className="pane-target" title={pane.target}>{pane.target}</span>
      </div>

      <div className="pane-semantic-body">
        <strong>{semantic.summary}</strong>
        {semantic.detail && <p>{semantic.detail}</p>}
      </div>

      <button
        className="pane-raw-toggle"
        type="button"
        onClick={() => setRawOpen(open => !open)}
        aria-expanded={rawOpen}
      >
        {rawOpen ? 'Hide raw terminal' : 'Inspect raw terminal'}
      </button>
      {rawOpen && <pre className="pane-content">{pane.content || '(empty)'}</pre>}

      <div className="pane-input">
        <input
          className="pane-msg-input"
          value={msg}
          onChange={e => setMsg(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleSend() }}
          placeholder="Send instruction to this pane…"
          disabled={sending}
        />
        <button
          className="pane-send-btn"
          onClick={() => void handleSend()}
          disabled={!msg.trim() || sending}
        >
          {sending ? '…' : '\u{27A4}'}
        </button>
      </div>
    </article>
  )
}

export function TeamsView() {
  const { panes, loading, loadPanes } = useTeamsStore()

  useEffect(() => {
    void loadPanes()
    const interval = setInterval(() => void loadPanes(), 3000)
    return () => clearInterval(interval)
  }, [loadPanes])

  const stateCounts = useMemo(() => {
    const counts: Record<PaneSemanticState, number> = {
      working: 0,
      waiting: 0,
      error: 0,
      idle: 0,
      unknown: 0,
    }
    for (const pane of panes) counts[describePane(pane).state] += 1
    return counts
  }, [panes])

  if (loading && panes.length === 0) {
    return <div className="teams-loading"><LoadingSpinner size={32} /></div>
  }

  if (panes.length === 0) {
    return (
      <div className="teams-empty">
        <EmptyState title="No active team panes" description="No tmux panes were found in the current AICIV session." />
      </div>
    )
  }

  return (
    <div className="teams-view">
      <div className="teams-heading">
        <div>
          <span className="teams-kicker">LIVE TEAM</span>
          <h2 className="teams-title">What the AICIV is doing</h2>
          <p className="teams-subtitle">
            Meaning-first summaries inferred from live tmux panes. Raw terminal output remains one click away.
          </p>
        </div>
        <div className="teams-summary" aria-label="Team activity summary">
          <span><strong>{stateCounts.working}</strong> working</span>
          <span><strong>{stateCounts.waiting}</strong> waiting</span>
          <span className={stateCounts.error ? 'teams-summary-alert' : ''}><strong>{stateCounts.error}</strong> attention</span>
          <span><strong>{panes.length}</strong> total</span>
        </div>
      </div>
      <div className="teams-grid">
        {panes.map(pane => <PaneCard key={pane.id} pane={pane} />)}
      </div>
    </div>
  )
}
