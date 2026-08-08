import type { Sheet, Workbook } from '../types/sheets'

interface DocContext {
  id: string
  title: string
  visibility?: string
  tags?: string[]
  content?: string
}

function bounded(value: string, max = 1600): string {
  const normalized = value.trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`
}

export function docContextEnvelope(doc: DocContext): string {
  const tags = doc.tags?.length ? doc.tags.join(', ') : '(none)'
  const excerpt = doc.content?.trim() ? `\nExcerpt:\n${bounded(doc.content)}` : ''
  return [
    '[SHARED DOC CONTEXT]',
    `Document ID: ${doc.id}`,
    `Title: ${doc.title}`,
    `Visibility: ${doc.visibility || 'unknown'}`,
    `Tags: ${tags}`,
    excerpt,
    '',
    'Work with me on this shared Portal document. Treat the document ID as the authoritative object reference. Do not claim any edit is saved unless you actually update the shared document and can verify it.',
  ].filter(Boolean).join('\n')
}

export function sheetContextEnvelope(workbook: Workbook | undefined, sheet: Sheet, rowsTotal: number): string {
  const columns = sheet.columns?.map(column => `${column.name}:${column.type}`).join(', ') || '(dynamic/unknown)'
  return [
    '[SHARED SHEET CONTEXT]',
    `Workbook ID: ${workbook?.id || '(unknown)'}`,
    `Workbook: ${workbook?.name || '(unknown)'}`,
    `Sheet ID: ${sheet.id}`,
    `Sheet: ${sheet.name}`,
    `Rows: ${rowsTotal}`,
    `Columns: ${columns}`,
    '',
    'Work with me on this shared Portal sheet. Treat the workbook/sheet IDs as authoritative object references. Inspect current rows before drawing conclusions or changing data, and do not claim a write succeeded without verifying it.',
  ].join('\n')
}

export function browserContextEnvelope(input: {
  title: string
  url: string
  evidenceId?: string
  evidenceUrl?: string
}): string {
  const evidence = input.evidenceId
    ? `\nShared evidence: ${input.evidenceId}${input.evidenceUrl ? ` (${input.evidenceUrl})` : ''}`
    : ''
  return [
    '[SHARED BROWSER CONTEXT]',
    `Page: ${input.title || '(untitled)'}`,
    `URL: ${input.url}`,
    evidence,
    '',
    'Inspect this shared browser context with me. Tell me what matters, what you notice, and what you recommend next. A saved screenshot is evidence only; it is not proof that any downstream task completed.',
  ].filter(Boolean).join('\n')
}
