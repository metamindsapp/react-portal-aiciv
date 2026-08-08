import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInboxStore, extractDecision } from '../../stores/inboxStore'
import type { AicivDecision, DecisionOption, InboxJobState } from '../../types/inbox'
import type { PresenceJob, PresenceReceipt } from '../../types/presence'
import { LoadingSpinner } from '../common/LoadingSpinner'
import './InboxView.css'

type InboxTab = 'needs' | 'results' | 'archive'

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])

function resultText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['summary', 'answer', 'result', 'conclusion', 'message']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function Receipt({ receipt }: { receipt: PresenceReceipt }) {
  const web = receipt.uri?.startsWith('https://') || receipt.uri?.startsWith('http://')
  const label = receipt.label || receipt.kind
  return (
    <div className="inbox-receipt">
      <span>{receipt.kind}</span>
      {web && receipt.uri ? (
        <a href={receipt.uri} target="_blank" rel="noopener noreferrer">{label}</a>
      ) : (
        <strong>{label}</strong>
      )}
      {receipt.uri && !web && <code>{receipt.uri}</code>}
    </div>
  )
}

function ResultCard({
  job,
  state,
  onSeen,
  onArchive,
  onRestore,
  archived,
}: {
  job: PresenceJob
  state: InboxJobState | undefined
  onSeen: (jobId: string) => void
  onArchive: (jobId: string) => void
  onRestore: (jobId: string) => void
  archived: boolean
}) {
  const unseen = !state?.seenAt
  const result = resultText(job.result)
  return (
    <article className={`inbox-card inbox-result-card ${unseen ? 'inbox-card-unseen' : ''}`}>
      <div className="inbox-card-head">
        <div className="inbox-card-title-wrap">
          {unseen && <span className="inbox-new-dot" title="New result" />}
          <div>
            <div className="inbox-card-kicker">
              <span className={`inbox-status inbox-status-${job.status}`}>{job.status}</span>
              <span>{relativeTime(job.updatedAt)}</span>
            </div>
            <h3>{job.goal}</h3>
          </div>
        </div>
        <span className="inbox-job-id" title={job.jobId}>{job.jobId}</span>
      </div>

      {job.error && <div className="inbox-error-copy">{job.error}</div>}
      {result && <div className="inbox-result-copy">{result}</div>}

      {job.receipts?.length > 0 && (
        <div className="inbox-receipts">
          <div className="inbox-receipts-label">Evidence & receipts</div>
          {job.receipts.slice(0, 8).map((receipt, index) => (
            <Receipt key={`${receipt.kind}-${receipt.uri ?? receipt.label ?? index}`} receipt={receipt} />
          ))}
        </div>
      )}

      <div className="inbox-card-actions">
        {!archived && unseen && (
          <button type="button" onClick={() => onSeen(job.jobId)}>Mark seen</button>
        )}
        {!archived ? (
          <button type="button" onClick={() => onArchive(job.jobId)}>Archive</button>
        ) : (
          <button type="button" onClick={() => onRestore(job.jobId)}>Restore</button>
        )}
        <Link to="/">Ask about this</Link>
      </div>
    </article>
  )
}

function DecisionCard({
  job,
  decision,
  state,
  onRespond,
}: {
  job: PresenceJob
  decision: AicivDecision
  state: InboxJobState | undefined
  onRespond: (job: PresenceJob, decision: AicivDecision, option: DecisionOption, note?: string) => Promise<boolean>
}) {
  const existing = state?.decisionResponses?.[decision.id]
  const [note, setNote] = useState('')
  const [sending, setSending] = useState<string | null>(null)

  const handleChoice = async (option: DecisionOption) => {
    setSending(option.id)
    await onRespond(job, decision, option, note)
    setSending(null)
  }

  return (
    <article className="inbox-card inbox-decision-card">
      <div className="inbox-decision-label">NEEDS YOU</div>
      <h3>{decision.question}</h3>
      {decision.context && <p className="inbox-decision-context">{decision.context}</p>}

      {decision.recommendation && (
        <div className="inbox-recommendation">
          <strong>AICIV recommendation</strong>
          <span>{decision.recommendation}</span>
        </div>
      )}
      {decision.risk && (
        <div className="inbox-risk"><strong>Risk / tradeoff:</strong> {decision.risk}</div>
      )}

      {existing ? (
        <div className="inbox-response-receipt">
          <strong>Response sent to AICIV:</strong> {existing.label || existing.optionId}
          <span>Delivery is recorded. Any downstream action still requires its own completion receipt.</span>
        </div>
      ) : (
        <>
          <div className="inbox-decision-options">
            {decision.options.map(option => (
              <button
                key={option.id}
                type="button"
                className="inbox-decision-option"
                disabled={sending !== null}
                onClick={() => void handleChoice(option)}
              >
                <strong>{sending === option.id ? 'Sending…' : option.label}</strong>
                {option.description && <span>{option.description}</span>}
              </button>
            ))}
          </div>
          <textarea
            className="inbox-decision-note"
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="Optional note to your AICIV…"
            rows={2}
          />
        </>
      )}

      <div className="inbox-card-meta">
        <span>{job.goal}</span>
        <span>{relativeTime(job.updatedAt)}</span>
      </div>
    </article>
  )
}

function WaitingCard({ job }: { job: PresenceJob }) {
  const latest = [...(job.events || [])]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  return (
    <article className="inbox-card inbox-waiting-card">
      <div className="inbox-decision-label">AICIV WAITING</div>
      <h3>{job.goal}</h3>
      <p>{latest?.message || 'The durable AICIV reported that this work is waiting for something.'}</p>
      <div className="inbox-card-actions">
        <Link to="/">Open conversation</Link>
        <Link to="/now">Open job in Now</Link>
      </div>
    </article>
  )
}

export function InboxView() {
  const {
    jobs,
    annotations,
    loading,
    refreshing,
    error,
    refresh,
    markSeen,
    archive,
    restore,
    respondToDecision,
  } = useInboxStore()
  const [tab, setTab] = useState<InboxTab>('needs')

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 12_000)
    return () => window.clearInterval(interval)
  }, [refresh])

  const visible = useMemo(
    () => jobs.filter(job => !annotations.jobs[job.jobId]?.archivedAt),
    [annotations.jobs, jobs],
  )
  const archivedJobs = useMemo(
    () => jobs.filter(job => Boolean(annotations.jobs[job.jobId]?.archivedAt)),
    [annotations.jobs, jobs],
  )

  const decisionJobs = useMemo(
    () => visible
      .filter(job => job.status === 'waiting' || job.status === 'cancel_requested')
      .map(job => ({ job, decision: extractDecision(job) })),
    [visible],
  )
  const needsYou = decisionJobs
  const results = useMemo(
    () => visible.filter(job => TERMINAL.has(job.status)),
    [visible],
  )
  const unseenResults = results.filter(job => !annotations.jobs[job.jobId]?.seenAt).length

  if (loading) {
    return <div className="inbox-loading"><LoadingSpinner size={36} /></div>
  }

  return (
    <div className="inbox-view">
      <header className="inbox-hero">
        <div>
          <div className="inbox-eyebrow">SHARED AICIV INBOX</div>
          <h2>Things your intelligence brought back — and things only you can decide.</h2>
          <p>Result state is authoritative from durable Presence jobs. Seen/archive/response state is shared by Portal across devices.</p>
        </div>
        <button type="button" className="inbox-refresh" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="inbox-error" role="status">{error}</div>}

      <nav className="inbox-tabs" aria-label="AICIV inbox sections">
        <button type="button" className={tab === 'needs' ? 'active' : ''} onClick={() => setTab('needs')}>
          Needs You <span>{needsYou.length}</span>
        </button>
        <button type="button" className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>
          Results <span>{unseenResults > 0 ? `${unseenResults} new` : results.length}</span>
        </button>
        <button type="button" className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>
          Archive <span>{archivedJobs.length}</span>
        </button>
      </nav>

      <main className="inbox-list">
        {tab === 'needs' && (
          needsYou.length === 0 ? (
            <div className="inbox-empty">
              <strong>Nothing needs your judgment right now.</strong>
              <span>Your AICIV can keep working until it reaches a genuine human decision boundary.</span>
            </div>
          ) : needsYou.map(({ job, decision }) => (
            decision ? (
              <DecisionCard
                key={`${job.jobId}:${decision.id}`}
                job={job}
                decision={decision}
                state={annotations.jobs[job.jobId]}
                onRespond={respondToDecision}
              />
            ) : (
              <WaitingCard key={job.jobId} job={job} />
            )
          ))
        )}

        {tab === 'results' && (
          results.length === 0 ? (
            <div className="inbox-empty">
              <strong>No returned results yet.</strong>
              <span>Receipt-backed completions from durable AICIV work will appear here.</span>
            </div>
          ) : results.map(job => (
            <ResultCard
              key={job.jobId}
              job={job}
              state={annotations.jobs[job.jobId]}
              onSeen={jobId => void markSeen(jobId)}
              onArchive={jobId => void archive(jobId)}
              onRestore={jobId => void restore(jobId)}
              archived={false}
            />
          ))
        )}

        {tab === 'archive' && (
          archivedJobs.length === 0 ? (
            <div className="inbox-empty">
              <strong>The archive is empty.</strong>
              <span>Archive finished items when you no longer need them in the active collaboration surface.</span>
            </div>
          ) : archivedJobs.map(job => (
            <ResultCard
              key={job.jobId}
              job={job}
              state={annotations.jobs[job.jobId]}
              onSeen={jobId => void markSeen(jobId)}
              onArchive={jobId => void archive(jobId)}
              onRestore={jobId => void restore(jobId)}
              archived
            />
          ))
        )}
      </main>
    </div>
  )
}
