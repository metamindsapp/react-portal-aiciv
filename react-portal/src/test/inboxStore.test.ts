import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendChatMessage } from '../api/chat'
import {
  fetchAicivInboxState,
  recordDecisionResponse,
} from '../api/inbox'
import { fetchPresenceJobs } from '../api/presence'
import { extractDecision, useInboxStore } from '../stores/inboxStore'
import type { AicivDecision, DecisionOption } from '../types/inbox'
import type { PresenceJob } from '../types/presence'

vi.mock('../api/chat', () => ({
  sendChatMessage: vi.fn(),
}))

vi.mock('../api/inbox', () => ({
  fetchAicivInboxState: vi.fn(),
  markInboxJobSeen: vi.fn(),
  archiveInboxJob: vi.fn(),
  restoreInboxJob: vi.fn(),
  recordDecisionResponse: vi.fn(),
}))

vi.mock('../api/presence', () => ({
  fetchPresenceJobs: vi.fn(),
}))

const waitingJob: PresenceJob = {
  jobId: 'job_0123456789abcdef01234567',
  goal: 'Choose the voice provider for cohort B',
  urgency: 'normal',
  status: 'waiting',
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:03:00.000Z',
  receipts: [],
  events: [
    {
      eventId: 'evt_decision_001',
      type: 'waiting',
      createdAt: '2026-08-08T12:03:00.000Z',
      message: 'Need rollout choice',
      result: {
        decision: {
          id: 'dec_provider',
          question: 'Which provider should we use?',
          context: 'B won latency; A has longer production history.',
          recommendation: 'Use B for a reversible cohort.',
          risk: 'B has less production history.',
          options: [
            { id: 'b', label: 'Use B', description: 'Use B with A as fallback.' },
            { id: 'a', label: 'Stay on A' },
          ],
          allowFreeform: true,
        },
      },
    },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  useInboxStore.setState({
    jobs: [],
    annotations: { version: 1, jobs: {} },
    loading: false,
    refreshing: false,
    error: null,
    lastUpdated: null,
  })
})

describe('extractDecision', () => {
  it('turns a structured waiting event into a human decision object', () => {
    const decision = extractDecision(waitingJob)
    expect(decision).not.toBeNull()
    expect(decision?.id).toBe('dec_provider')
    expect(decision?.question).toBe('Which provider should we use?')
    expect(decision?.recommendation).toContain('Use B')
    expect(decision?.options.map(option => option.id)).toEqual(['b', 'a'])
  })

  it('does not invent a decision from ordinary waiting prose', () => {
    const job: PresenceJob = {
      ...waitingJob,
      events: [
        {
          eventId: 'evt_wait_001',
          type: 'waiting',
          createdAt: '2026-08-08T12:04:00.000Z',
          message: 'Waiting for remote benchmark upload',
        },
      ],
    }
    expect(extractDecision(job)).toBeNull()
  })
})

describe('InboxStore decision delivery', () => {
  const decision = extractDecision(waitingJob) as AicivDecision
  const option = decision.options[0] as DecisionOption

  it('records shared response state only after Portal accepts delivery to the AICIV', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ ok: true })
    vi.mocked(recordDecisionResponse).mockResolvedValue({
      jobId: waitingJob.jobId,
      decisionId: decision.id,
      response: {
        optionId: option.id,
        label: option.label,
        message: 'Keep rollback easy',
        respondedAt: '2026-08-08T12:05:00.000Z',
      },
      semanticReceipt: 'inbox_annotation_recorded_not_delivery_or_execution',
    })

    const ok = await useInboxStore.getState().respondToDecision(
      waitingJob,
      decision,
      option,
      'Keep rollback easy',
    )

    expect(ok).toBe(true)
    expect(sendChatMessage).toHaveBeenCalledOnce()
    const delivered = vi.mocked(sendChatMessage).mock.calls[0]?.[0] ?? ''
    expect(delivered).toContain(`[AICIV DECISION RESPONSE job=${waitingJob.jobId}`)
    expect(delivered).toContain('It is NOT proof that any downstream action has completed')
    expect(recordDecisionResponse).toHaveBeenCalledOnce()
    expect(
      useInboxStore.getState().annotations.jobs[waitingJob.jobId]?.decisionResponses?.[decision.id]?.optionId,
    ).toBe(option.id)
  })

  it('does not create a response annotation when AICIV delivery fails', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new Error('portal offline'))

    const ok = await useInboxStore.getState().respondToDecision(waitingJob, decision, option)

    expect(ok).toBe(false)
    expect(recordDecisionResponse).not.toHaveBeenCalled()
    expect(useInboxStore.getState().error).toContain('Could not deliver')
  })
})

describe('InboxStore refresh', () => {
  it('joins authoritative jobs with server-shared collaboration annotations', async () => {
    vi.mocked(fetchPresenceJobs).mockResolvedValue({ jobs: [waitingJob], count: 1 })
    vi.mocked(fetchAicivInboxState).mockResolvedValue({
      version: 1,
      jobs: {
        [waitingJob.jobId]: { seenAt: '2026-08-08T12:06:00.000Z' },
      },
    })

    await useInboxStore.getState().refresh()

    expect(useInboxStore.getState().jobs).toHaveLength(1)
    expect(useInboxStore.getState().annotations.jobs[waitingJob.jobId]?.seenAt).toBeTruthy()
    expect(useInboxStore.getState().error).toBeNull()
  })
})
