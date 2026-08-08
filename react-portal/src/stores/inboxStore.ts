import { create } from 'zustand'
import { sendChatMessage } from '../api/chat'
import {
  archiveInboxJob,
  fetchAicivInboxState,
  markInboxJobSeen,
  recordDecisionResponse,
  restoreInboxJob,
} from '../api/inbox'
import { fetchPresenceJobs } from '../api/presence'
import type { AicivDecision, AicivInboxState, DecisionOption, InboxJobState } from '../types/inbox'
import type { PresenceJob, PresenceJobEvent } from '../types/presence'

interface InboxState {
  jobs: PresenceJob[]
  annotations: AicivInboxState
  loading: boolean
  refreshing: boolean
  error: string | null
  lastUpdated: number | null
  refresh: () => Promise<void>
  markSeen: (jobId: string) => Promise<boolean>
  archive: (jobId: string) => Promise<boolean>
  restore: (jobId: string) => Promise<boolean>
  respondToDecision: (
    job: PresenceJob,
    decision: AicivDecision,
    option: DecisionOption,
    message?: string,
  ) => Promise<boolean>
}

const EMPTY_STATE: AicivInboxState = { version: 1, jobs: {} }

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeOption(value: unknown, index: number): DecisionOption | null {
  if (typeof value === 'string' && value.trim()) {
    return { id: `option_${index + 1}`, label: value.trim() }
  }
  const record = toRecord(value)
  if (!record) return null
  const label = typeof record.label === 'string'
    ? record.label.trim()
    : typeof record.title === 'string'
      ? record.title.trim()
      : ''
  if (!label) return null
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `option_${index + 1}`
  const description = typeof record.description === 'string' && record.description.trim()
    ? record.description.trim()
    : undefined
  return description ? { id, label, description } : { id, label }
}

function parseDecision(event: PresenceJobEvent): AicivDecision | null {
  const result = toRecord(event.result)
  if (!result) return null
  const nested = toRecord(result.decision) ?? toRecord(result.approval) ?? result
  const question = typeof nested.question === 'string'
    ? nested.question.trim()
    : typeof nested.prompt === 'string'
      ? nested.prompt.trim()
      : ''
  if (!question) return null

  const rawOptions = Array.isArray(nested.options) ? nested.options : []
  const options = rawOptions
    .map(normalizeOption)
    .filter((option): option is DecisionOption => option !== null)
  if (options.length === 0) return null

  const id = typeof nested.id === 'string' && nested.id.trim()
    ? nested.id.trim()
    : event.eventId
  const decision: AicivDecision = { id, question, options }
  if (typeof nested.context === 'string' && nested.context.trim()) decision.context = nested.context.trim()
  if (typeof nested.recommendation === 'string' && nested.recommendation.trim()) decision.recommendation = nested.recommendation.trim()
  if (typeof nested.risk === 'string' && nested.risk.trim()) decision.risk = nested.risk.trim()
  if (typeof nested.allowFreeform === 'boolean') decision.allowFreeform = nested.allowFreeform
  return decision
}

export function extractDecision(job: PresenceJob): AicivDecision | null {
  const events = [...(job.events || [])].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
  for (const event of events) {
    if (event.type !== 'waiting' && event.type !== 'progress') continue
    const decision = parseDecision(event)
    if (decision) return decision
  }
  return null
}

function updateAnnotation(
  annotations: AicivInboxState,
  jobId: string,
  state: InboxJobState,
): AicivInboxState {
  return {
    ...annotations,
    jobs: {
      ...annotations.jobs,
      [jobId]: state,
    },
  }
}

function decisionEnvelope(
  job: PresenceJob,
  decision: AicivDecision,
  option: DecisionOption,
  message?: string,
): string {
  const lines = [
    `[AICIV DECISION RESPONSE job=${job.jobId} decision=${decision.id} option=${option.id}]`,
    `Human selection: ${option.label}`,
  ]
  if (message?.trim()) lines.push(`Human note: ${message.trim()}`)
  lines.push(
    '',
    'This confirms the human decision was delivered into the primary AICIV conversation. It is NOT proof that any downstream action has completed. Continue the durable job and report actual results/receipts through the Presence job callback.',
  )
  return lines.join('\n')
}

export const useInboxStore = create<InboxState>((set, get) => ({
  jobs: [],
  annotations: EMPTY_STATE,
  loading: true,
  refreshing: false,
  error: null,
  lastUpdated: null,

  refresh: async () => {
    const first = get().lastUpdated == null
    set({ refreshing: true, error: null, ...(first ? { loading: true } : {}) })

    const [jobsResult, stateResult] = await Promise.allSettled([
      fetchPresenceJobs(100),
      fetchAicivInboxState(),
    ])

    const failures: string[] = []
    let jobs = get().jobs
    let annotations = get().annotations

    if (jobsResult.status === 'fulfilled') {
      jobs = jobsResult.value.jobs || []
    } else {
      failures.push('Durable Presence jobs are unavailable.')
    }

    if (stateResult.status === 'fulfilled') {
      annotations = stateResult.value
    } else {
      failures.push('Shared inbox state is unavailable.')
    }

    set({
      jobs,
      annotations,
      loading: false,
      refreshing: false,
      error: failures.length ? failures.join(' ') : null,
      lastUpdated: Date.now(),
    })
  },

  markSeen: async (jobId) => {
    try {
      const response = await markInboxJobSeen(jobId)
      set(state => ({ annotations: updateAnnotation(state.annotations, jobId, response.state) }))
      return true
    } catch {
      set({ error: 'Could not mark that result as seen.' })
      return false
    }
  },

  archive: async (jobId) => {
    try {
      const response = await archiveInboxJob(jobId)
      set(state => ({ annotations: updateAnnotation(state.annotations, jobId, response.state) }))
      return true
    } catch {
      set({ error: 'Could not archive that inbox item.' })
      return false
    }
  },

  restore: async (jobId) => {
    try {
      const response = await restoreInboxJob(jobId)
      set(state => ({ annotations: updateAnnotation(state.annotations, jobId, response.state) }))
      return true
    } catch {
      set({ error: 'Could not restore that inbox item.' })
      return false
    }
  },

  respondToDecision: async (job, decision, option, message) => {
    try {
      const delivery = await sendChatMessage(decisionEnvelope(job, decision, option, message))
      if (!delivery.ok) {
        set({ error: 'The decision response was not accepted by Portal.' })
        return false
      }

      try {
        const body: { optionId: string; label?: string; message?: string } = {
          optionId: option.id,
          label: option.label,
        }
        if (message?.trim()) body.message = message.trim()
        const recorded = await recordDecisionResponse(job.jobId, decision.id, body)
        const current = get().annotations.jobs[job.jobId] ?? { decisionResponses: {} }
        const updated: InboxJobState = {
          ...current,
          seenAt: current.seenAt ?? recorded.response.respondedAt,
          decisionResponses: {
            ...(current.decisionResponses || {}),
            [decision.id]: recorded.response,
          },
        }
        set(state => ({
          annotations: updateAnnotation(state.annotations, job.jobId, updated),
          error: null,
        }))
      } catch {
        // Delivery to the AICIV succeeded. Do not lie and report failure of the
        // human decision merely because local inbox annotation persistence failed.
        set({ error: 'Decision response was delivered, but Portal could not save the inbox annotation. Refresh to reconcile.' })
      }
      return true
    } catch {
      set({ error: 'Could not deliver that decision response to the primary AICIV.' })
      return false
    }
  },
}))
