import { describe, expect, it } from 'vitest'
import { browserContextEnvelope, docContextEnvelope, sheetContextEnvelope } from '../domain/contextEnvelopes'

describe('AICIV shared object context envelopes', () => {
  it('keeps a document anchored to its authoritative object ID and bounded excerpt', () => {
    const text = docContextEnvelope({
      id: 'doc_123',
      title: 'Voice Architecture',
      visibility: 'private',
      tags: ['presence', 'voice'],
      content: 'x'.repeat(3000),
    })
    expect(text).toContain('Document ID: doc_123')
    expect(text).toContain('Voice Architecture')
    expect(text.length).toBeLessThan(2300)
    expect(text).toMatch(/do not claim any edit is saved/i)
  })

  it('describes shared sheet identity and verification discipline', () => {
    const text = sheetContextEnvelope(
      { id: 'wb_1', name: 'Providers', sheets: [], created_at: 'now' },
      { id: 'sheet_1', name: 'Latency', columns: [{ name: 'p95', type: 'number' }], created_at: 'now' },
      42,
    )
    expect(text).toContain('Workbook ID: wb_1')
    expect(text).toContain('Sheet ID: sheet_1')
    expect(text).toContain('p95:number')
    expect(text).toMatch(/do not claim a write succeeded/i)
  })

  it('labels browser screenshots as evidence rather than completion', () => {
    const text = browserContextEnvelope({
      title: 'Benchmark',
      url: 'https://example.com',
      evidenceId: 'evidence_abc',
      evidenceUrl: '/api/chat/uploads/x.png',
    })
    expect(text).toContain('evidence_abc')
    expect(text).toMatch(/evidence only/i)
    expect(text).toMatch(/not proof/i)
  })
})
