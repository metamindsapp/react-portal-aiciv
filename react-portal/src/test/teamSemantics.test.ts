import { describe, expect, it } from 'vitest'
import { describePane, stripTerminalNoise } from '../domain/teamSemantics'

const pane = (content: string) => ({ id: '1', title: 'Researcher', target: '0:1.0', content })

describe('team semantic projection', () => {
  it('strips terminal escape noise', () => {
    expect(stripTerminalNoise('\u001b[31mERROR\u001b[0m\r\n')).toContain('ERROR')
    expect(stripTerminalNoise('\u001b[31mERROR\u001b[0m')).not.toContain('\u001b[')
  })

  it('recognizes meaningful working/waiting/error states', () => {
    expect(describePane(pane('Running tests…\nEsc to interrupt')).state).toBe('working')
    expect(describePane(pane('Waiting for human approval before deploy')).state).toBe('waiting')
    expect(describePane(pane('Build failed: TypeScript error')).state).toBe('error')
  })

  it('keeps ambiguous state explicitly non-authoritative', () => {
    const view = describePane(pane('looked at three files\nupdated notes'))
    expect(view.state).toBe('unknown')
    expect(view.detail).toMatch(/inferred/i)
  })
})
