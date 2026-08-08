import { describe, expect, it } from 'vitest'
import {
  docCommandEntries,
  jobCommandEntries,
  messageCommandEntries,
  projectCommandEntries,
  rankCommandEntries,
  routeCommandEntries,
} from '../search/commandPalette'
import type { Doc } from '../types/docs'
import type { ChatMessage } from '../types/chat'
import type { PresenceJob } from '../types/presence'
import type { AicivProject } from '../types/projects'

const project: AicivProject = {
  projectId: 'prj_0123456789abcdef01234567',
  title: 'Presence Product',
  goal: 'Ship a product-level voice system across Portal and Reachy',
  summary: 'Build the shared Presence layer with durable cognition handoff.',
  status: 'active',
  tags: ['voice', 'reachy', 'product'],
  links: [],
  createdAt: '2026-08-08T11:00:00.000Z',
  updatedAt: '2026-08-08T12:10:00.000Z',
}

const job: PresenceJob = {
  jobId: 'job_0123456789abcdef01234567',
  goal: 'Compare ElevenLabs and OpenAI voice latency',
  expectedReturn: 'A short recommendation with evidence',
  urgency: 'normal',
  status: 'succeeded',
  surface: 'voice',
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:05:00.000Z',
  result: { summary: 'ElevenLabs path won interruption quality.' },
  receipts: [],
  events: [],
}

const doc: Doc = {
  id: 'doc_voice_arch',
  title: 'Voice Presence Architecture',
  content: 'Presence handles low latency conversation while durable cognition handles long work.',
  visibility: 'private',
  tags: ['voice', 'presence'],
}

const message: ChatMessage = {
  id: 'msg_123',
  role: 'assistant',
  text: 'The durable job should survive the WebRTC session ending.',
  timestamp: 1_786_187_100,
}

describe('command palette index', () => {
  it('finds an exact Portal destination by human intent keywords', () => {
    const ranked = rankCommandEntries(routeCommandEntries(), 'returned results')
    expect(ranked[0]?.route).toBe('/inbox')
  })

  it('searches the exact AICIV project by goal, summary, tags, and status', () => {
    const ranked = rankCommandEntries(projectCommandEntries([project]), 'reachy durable cognition')
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.kind).toBe('project')
    expect(ranked[0]?.project?.projectId).toBe(project.projectId)
  })

  it('searches durable jobs by goal/status/expected return', () => {
    const ranked = rankCommandEntries(jobCommandEntries([job]), 'voice latency evidence')
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.kind).toBe('job')
    expect(ranked[0]?.job?.jobId).toBe(job.jobId)
  })

  it('searches Docs by title, tags, and body content', () => {
    const ranked = rankCommandEntries(docCommandEntries([doc]), 'durable cognition')
    expect(ranked[0]?.doc?.id).toBe(doc.id)

    const byTag = rankCommandEntries(docCommandEntries([doc]), 'voice presence')
    expect(byTag[0]?.doc?.title).toBe('Voice Presence Architecture')
  })

  it('searches recent conversation text and retains the exact message id', () => {
    const ranked = rankCommandEntries(messageCommandEntries([message]), 'WebRTC session')
    expect(ranked[0]?.messageId).toBe('msg_123')
  })

  it('requires every query token to match somewhere in the same object', () => {
    const entries = [
      ...projectCommandEntries([project]),
      ...docCommandEntries([doc]),
      ...jobCommandEntries([job]),
    ]
    expect(rankCommandEntries(entries, 'presence nonexistent-token')).toEqual([])
  })
})
